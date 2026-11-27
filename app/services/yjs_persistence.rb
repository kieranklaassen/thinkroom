# Server-side Yjs state handling via yrby (thread-safe, GVL-releasing Rust yrs
# bindings). The server never interprets document structure — it blindly merges
# binary updates (commutative, idempotent) into the stored blob and serves the
# merged state + state vector to joining clients.
#
# Cold recovery, archival, checksum verification, and compaction live in
# YjsRecovery.
class YjsPersistence
  # Raised when a stored blob fails its checksum or cannot be synced into a
  # fresh doc. Callers holding the document locks heal via
  # YjsRecovery.heal_corrupt_state! and retry.
  class CorruptStateError < StandardError; end

  # Bounded 64-stripe in-process lock table. ActionCable handles channel
  # actions on a thread pool; without this, two concurrent receives could
  # both read the same stored blob and the later write would drop the earlier
  # update. Fixed striping caps in-process lock memory permanently while
  # keeping per-document serialization (the DB row lock is the second guard).
  LOCK_STRIPES = 64
  LOCKS = Array.new(LOCK_STRIPES) { Mutex.new }.freeze

  CHECKPOINT_INTERVAL = YjsRecovery::CHECKPOINT_INTERVAL
  ORPHAN_TTL = YjsRecovery::ORPHAN_TTL

  # A merge triggers an inline fold when unexamined tail rows reach this
  # count, bounding tail growth during long sessions with no joins or
  # disconnects without re-folding on lingering retained pending rows.
  FOLD_THRESHOLD = 64

  # The byte signature of an exactly-empty v1 update (zero structs, zero
  # deletes) — what a joining client with nothing new sends as sync-reply.
  EMPTY_UPDATE = "\x00\x00".b.freeze

  # The byte signature of an empty Yjs state vector (zero client clocks).
  EMPTY_STATE_VECTOR = "\x00".b.freeze

  # Matches DocumentsController::MAX_STATE_VECTOR_BYTES so a handshake sv param
  # cannot force oversized decodes on subscribe.
  MAX_STATE_VECTOR_BYTES = 64.kilobytes
  MAX_STATE_VECTOR_B64_BYTES = ((MAX_STATE_VECTOR_BYTES + 2) / 3) * 4

  # Maximum decoded size of a single incoming Yjs update frame, mirrored in
  # DocumentsController and the frontend document size guard.
  MAX_UPDATE_BYTES = 2.megabytes

  # Pre-decode Base64 length cap corresponding to MAX_UPDATE_BYTES so
  # oversized wire payloads are rejected before allocating/decoding.
  MAX_UPDATE_B64_BYTES = (MAX_UPDATE_BYTES * 4 / 3) + 4

  # Maximum pieces and total decoded bytes one split edit may carry (see
  # merge_updates). Mirrors CableProvider and derives from MAX_DOCUMENT_SIZE
  # (2 MiB UTF-16 units in app/frontend/editor/document_size_guard.ts): up to
  # 6 MiB of 3-byte UTF-8 text plus 1 MiB for nodes and marks, across at most
  # 5 pieces (4 full 2 MiB pieces plus 1 leading piece before a split string).
  MAX_SPLIT_UPDATES = 5
  MAX_SPLIT_UPDATE_BYTES = 7.megabytes

  class << self
    # Parse a wire-supplied content_generation into a non-negative Integer, or
    # nil if absent/malformed. Shared by SyncChannel and DocumentsController so
    # both transports enforce identical generation validation.
    def parse_generation(value)
      parsed = case value
      when Integer then value
      when String then Integer(value, 10, exception: false)
      end
      parsed if parsed && parsed >= 0
    end

    # Merge a base64-encoded Yjs update into the document's persisted state.
    # Convenience wrapper over merge_bytes for callers holding a base64 frame;
    # transport boundaries decode once and call merge_bytes (SyncChannel) or
    # merge_updates (DocumentsController) directly.
    def merge(document, base64_update, generation: document.content_generation, seed_claim: nil, token: nil, user: nil)
      merge_bytes(document, decode(base64_update), generation:, seed_claim:, token:, user:)
    end

    # Merge one raw binary Yjs update; see merge_updates.
    def merge_bytes(document, update, **)
      merge_updates(document, [ update ], **)
    end

    # Merge raw binary Yjs updates into the document's persisted state: one edit,
    # in clock order, that its client split when no single update could hold it.
    # All or nothing, and under one lock: yrs may integrate a later
    # piece without the earlier one, so a fold in between could lose it. Folded
    # at once, so the same edit sent again leaves no rows behind.
    #
    # `generation` is the sending client's required Document#content_generation
    # integer. A missing, malformed, or mismatched generation means the client
    # is out of date with an owner CLI replacement (Document#replace_content!)
    # or untrusted: merging could resurrect wiped CRDT content, so the update is
    # rejected with Document::StaleGenerationError rather than persisted.
    #
    # `seed_claim` is present on a claimant's writes until its seed is known to
    # be stored. The first seed stored wins; see seed_claim_holds?.
    def merge_updates(document, updates, generation:, seed_claim: nil, token: nil, user: nil)
      updates = updates.map(&:b)
      raise ArgumentError, "no Yjs update for document #{document.id}" if updates.empty?

      ActiveSupport::Notifications.instrument(
        "merge.yjs", document_id: document.id, update_bytes: updates.sum(&:bytesize)
      ) do |payload|
        # Fast pre-lock checks: reject unauthorized callers, missing/malformed
        # generations, and undecodable updates before taking the per-document
        # mutex or SQLite row lock so untrusted frames never stall writers.
        unless document.writable_by?(token, user:) || document.reload.writable_by?(token, user:)
          payload[:outcome] = "rejected_locked"
          raise Document::EditingLockedError, "This document is read-only."
        end
        unless generation.is_a?(Integer)
          payload[:outcome] = "rejected_stale"
          raise Document::StaleGenerationError,
                "Client generation #{generation.inspect} is missing or invalid."
        end
        unless updates.all? { |update| update == EMPTY_UPDATE || decodable_update?(update) }
          payload[:outcome] = "rejected_undecodable"
          raise ArgumentError, "undecodable Yjs update for document #{document.id}"
        end

        non_empty = updates - [ EMPTY_UPDATE ]
        split_check, snapshot_marker =
          if non_empty.many?
            validate_split_updates(document, non_empty, generation:, payload:)
          end

        entered_at = monotonic_ms
        lock_for(document.id).synchronize do
          document.with_lock do
            payload[:lock_wait_ms] = (monotonic_ms - entered_at).round(1)
            document.reload
            unless document.writable_by?(token, user:)
              payload[:outcome] = "rejected_locked"
              raise Document::EditingLockedError, "This document is read-only."
            end
            unless generation == document.content_generation
              payload[:outcome] = "rejected_stale"
              raise Document::StaleGenerationError,
                    "Client generation #{generation} is behind document generation #{document.content_generation}."
            end

            # The empty update (a joining client's sync-reply when it has
            # nothing new) must not append — flipping seed_state to
            # "seeded" without content would permanently block the seed
            # claim, and every join would bloat the log otherwise.
            updates -= [ EMPTY_UPDATE ]
            if updates.empty?
              payload[:outcome] = "noop"
              next
            end

            unless seed_claim.nil? || seed_claim_holds?(document, updates.first, seed_claim)
              payload[:outcome] = "rejected_seed_claim"
              raise Document::StaleSeedClaimError, "Another seed is already stored."
            end

            if split_check == :already_stored &&
               [ document.yjs_state_checksum, document.yjs_state.present? ] == snapshot_marker
              payload[:outcome] = "noop"
              next true
            end

            # The durable act: an O(update) append. A single update builds no
            # Y::Doc on this path unless the tail is at its threshold; a split
            # edit is folded below. Other folds materialize the tail into the
            # snapshot columns on joins and disconnects.
            updates.each do |update|
              document.yjs_document_updates.create!(
                content_generation: document.content_generation,
                payload: update
              )
            end
            unless document.seed_state == "seeded"
              document.update_columns(seed_state: "seeded", updated_at: Time.current)
            end
            payload[:outcome] = "appended"
            payload[:tail_rows] = document.yjs_document_updates.unexamined.count
            perform_fold(document) if updates.many? || payload[:tail_rows] >= FOLD_THRESHOLD
            true
          end
        end
      end
    end

    # => [full_state_b64, state_vector_b64] for the sync handshake.
    #
    # The stored blob is exactly the previous fold's materialized snapshot
    # and the stored vector its state, so when both columns are present and
    # no unfolded tail exists the handshake is served from them directly —
    # no Y::Doc instantiation.
    # Documents written before yjs_state_vector existed (blob present,
    # vector nil) fall back to rebuilding; their next merge heals them.
    def state_b64(document)
      ActiveSupport::Notifications.instrument("state.yjs", document_id: document.id) do |payload|
        encoded = begin
          if document.yjs_document_updates.exists?
            fold_and_encode_handshake(document, payload)
          else
            # An empty tail may have been folded since this row was loaded.
            document.reload
            encode_handshake(document, payload)
          end
        rescue CorruptStateError
          heal_and_reencode_handshake(document, payload)
        end
        # Outcome is assigned last so an exception leaves it unset and the
        # log subscriber's exception fallback classifies the event as a
        # failure rather than a success.
        payload[:outcome] = "ok"
        encoded
      end
    end

    # => [delta_or_full_b64, state_vector_b64] for a differential sync handshake.
    #
    # Computes only the missing Yjs delta relative to the client's state vector
    # via yrby's `encode_state_as_update(client_sv)`. Falls back cleanly to full
    # `state_b64(document)` when `client_sv_b64` is absent, oversized, or
    # invalid, and delegates directly to `state_b64(document)` for the empty
    # state vector so cold clients keep the zero-Y::Doc column fast path.
    def diff_b64(document, client_sv_b64)
      client_sv = decode_client_state_vector(client_sv_b64)
      return state_b64(document) if client_sv.nil? || client_sv == EMPTY_STATE_VECTOR

      ActiveSupport::Notifications.instrument("state.yjs", document_id: document.id) do |payload|
        encoded = begin
          if document.yjs_document_updates.exists?
            fold_and_encode_diff(document, client_sv, payload)
          else
            document.reload
            encode_diff(document, client_sv, payload)
          end
        rescue CorruptStateError
          heal_and_reencode_diff(document, client_sv, payload)
        end
        payload[:outcome] = "ok"
        encoded
      end
    end

    # Persist a derived source/provenance snapshot only when the submitting
    # client has observed every Yjs update currently stored by the server.
    # A client may be ahead (its own cable frame is still in flight), but it
    # may not overwrite the API read model from behind.
    #
    # `render_hints` (optional, pre-sanitized by the controller) carries
    # client-measured render geometry — currently Mermaid figure heights keyed
    # by source hash — merged per namespace so hints from other diagrams are
    # not lost between snapshots.
    def persist_snapshot(document, state_vector_b64:, content:, spans:, title: document.title,
                         render_hints: nil, token: nil, user: nil)
      ActiveSupport::Notifications.instrument("snapshot.yjs", document_id: document.id) do |payload|
        client_state = decode_state_vector(decode(state_vector_b64)) if state_vector_b64.present?

        with_document_lock(document) do
          unless document.writable_by?(token, user:)
            payload[:outcome] = "rejected_locked"
            raise Document::EditingLockedError, "This document is read-only."
          end

          # The staleness gate must compare against the full live state,
          # so unfolded tail rows are folded into the snapshot first.
          perform_fold(document) if document.yjs_document_updates.exists?

          if client_state && document.yjs_state.present?
            server_state = begin
              decode_state_vector(server_state_vector(document))
            rescue ArgumentError, CorruptStateError
              # A corrupt stored vector (or, on legacy rows without a
              # stored vector, a corrupt blob) must not masquerade as
              # client staleness — heal and derive the truth instead.
              decode_state_vector(load_or_heal_ydoc(document).encode_state_vector)
            end
            current = server_state.all? do |client_id, clock|
              client_state.fetch(client_id, 0) >= clock
            end
            unless current
              payload[:outcome] = "rejected_stale_vector"
              return false
            end
          end

          attributes = { title:, content_snapshot: content, provenance_spans: spans }
          if render_hints.present?
            attributes[:render_hints] = RenderHints.merge(document.render_hints || {}, render_hints)
          end
          document.update!(attributes)
          payload[:outcome] = "persisted"
        end
        true
      rescue ArgumentError => e
        # A state vector that cannot be decoded is a client bug or corruption,
        # not ordinary staleness — the outcome (with the error message) makes
        # it distinguishable in the event stream, while the false return keeps
        # callers treating it as "snapshot not accepted".
        payload[:outcome] = "invalid_state_vector"
        payload[:error] = e.message
        false
      end
    end

    # Fold the document's update tail into its snapshot columns, acquiring
    # the persistence locks. Lifecycle callers (last disconnect,
    # replace_content!) use this; merge/persist_snapshot fold inline under
    # the locks they already hold.
    def fold!(document)
      return unless document.yjs_document_updates.exists?

      with_document_lock(document) do
        perform_fold(document)
      end
    end

    def compact!(document)
      YjsRecovery.compact!(document)
    end

    # --- Internal collaboration hooks shared with YjsRecovery ---------------

    def with_document_lock(document)
      lock_for(document.id).synchronize do
        # with_lock has just reloaded the row inside its transaction.
        document.with_lock { yield }
      end
    end

    # Materialize snapshot + tail and persist, deleting only rows provably
    # incorporated. Callers must hold both locks. Returns the folded doc.
    #
    # Row classification:
    # - older generation -> delete (a replacement wiped that state)
    # - undecodable row  -> quarantine immediately (QUARANTINE) and delete
    # - gap-free batch (!ydoc.pending?) -> every applied row integrated cleanly;
    #   delete all applied rows with no per-row probe
    # - gapped batch (ydoc.pending?) -> verify compacted_state_update once into
    #   a single `base` doc and judge each applied row against it:
    #   - ready and does not advance `base` -> fully captured (including
    #     deletes whose target structs are already integrated and joiner
    #     delete-set echoes), delete
    #   - otherwise (pending structs, mixed integrated+pending frames, or
    #     out-of-order deletes whose target structs have not arrived) -> retain
    #     for the next fold (stamping retained_at), quarantine after ORPHAN_TTL
    def perform_fold(document)
      # Not through the association, which would wire every row back to the
      # document; a fold reads only the rows' own columns.
      rows = YjsDocumentUpdate.where(document_id: document.id).order(:id).to_a
      return load_or_heal_ydoc(document) if rows.empty?

      ActiveSupport::Notifications.instrument("fold.yjs", document_id: document.id, rows: rows.length) do |payload|
        ydoc = load_or_heal_ydoc(document)
        before_fingerprint = state_fingerprint(ydoc)
        integrated_ids = []
        applied = []
        retained = []
        undecodable = []

        rows.each do |row|
          if row.content_generation != document.content_generation
            integrated_ids << row.id
            next
          end

          begin
            ydoc.apply_update(row.payload)
            applied << row
          rescue StandardError => e
            undecodable << [ row, e ]
          end
        end

        blob = nil
        base = nil
        persisting = false

        if applied.any?
          if !ydoc.pending?
            after_fingerprint = state_fingerprint(ydoc)
            state_changed = before_fingerprint.nil? || after_fingerprint != before_fingerprint
            if state_changed
              blob = ydoc.compacted_state_update
              still_empty = document.yjs_state.nil? && blob == EMPTY_UPDATE
              persisting = !still_empty
              if persisting
                payload[:blob_bytes_after] = blob.bytesize
                unless blob_loadable?(blob)
                  # Serve clients from the in-memory doc but never persist a
                  # blob that would brick future loads; all rows stay for the
                  # next fold.
                  payload[:outcome] = "invalid_encode"
                  return ydoc
                end
              end
            end
            integrated_ids.concat(applied.map(&:id))
          else
            blob = ydoc.compacted_state_update
            base = load_verified_blob(blob)
            unless base
              payload[:outcome] = "invalid_encode"
              return ydoc
            end

            after_fingerprint = state_fingerprint(base)
            state_changed = before_fingerprint.nil? || after_fingerprint != before_fingerprint
            still_empty = document.yjs_state.nil? && blob == EMPTY_UPDATE
            persisting = state_changed && !still_empty
            payload[:blob_bytes_after] = blob.bytesize if persisting

            applied.each do |row|
              if base.update_ready?(row.payload) && !base.update_advances?(row.payload)
                integrated_ids << row.id
              else
                retained << row
              end
            end
          end
        end

        if persisting
          YjsRecovery.maybe_checkpoint(document)
          document.update_columns(
            yjs_state: blob,
            yjs_state_vector: (base || ydoc).encode_state_vector,
            yjs_state_checksum: YjsRecovery.state_checksum(blob),
            updated_at: Time.current
          )
        end

        YjsRecovery.quarantine_poison_pills(document, undecodable)
        YjsRecovery.quarantine_orphans(document, retained)
        newly_retained_ids = retained.select { |row| row.retained_at.nil? }.map(&:id)
        if newly_retained_ids.any?
          document.yjs_document_updates.where(id: newly_retained_ids).update_all(retained_at: Time.current)
        end
        document.yjs_document_updates.where(id: integrated_ids).delete_all if integrated_ids.any?

        payload[:integrated] = integrated_ids.length
        payload[:retained] = retained.length
        payload[:quarantined] = undecodable.length if undecodable.any?
        payload[:outcome] = "folded"
        ydoc
      end
    end

    # For callers already holding both document locks (merge,
    # persist_snapshot, compact!): a corrupt blob heals in place and the load
    # retries once on the restored state.
    def load_or_heal_ydoc(document)
      load_ydoc(document)
    rescue CorruptStateError => e
      YjsRecovery.heal_corrupt_state!(document, e)
      load_ydoc(document)
    end

    def blob_loadable?(blob)
      !load_verified_blob(blob).nil?
    end

    private

    # Callers hold both locks. While nothing is stored any claimant may write,
    # even one whose claim was taken over: there is nothing to double yet.
    # Existing content is compatible only when it is
    # this claimant's own earlier write: one client's structs all carry its Yjs
    # client id, so a repeat (HTTP and cable both deliver the seed) shares it.
    def seed_claim_holds?(document, update, seed_claim)
      return false unless seed_claim.is_a?(String) && seed_claim.match?(Document::SEED_CLAIM_TOKEN)
      return true unless document.live_crdt?

      writers = decode_state_vector(load_verified_blob(update).encode_state_vector).keys
      stored = decode_state_vector(perform_fold(document).encode_state_vector).keys
      writers.intersect?(stored)
    end

    def monotonic_ms
      Process.clock_gettime(Process::CLOCK_MONOTONIC, :float_millisecond)
    end

    # Updates with unmet causal dependencies park cleanly; genuine garbage
    # raises inside yrs.
    def decodable_update?(update)
      !load_verified_blob(update).nil?
    end

    # Verify a split edit is complete against the current integrated document
    # state before acquiring the write lock. Reading tail rows before reloading
    # the document ensures a concurrent fold between the two reads only adds to
    # what we load. Returns [:already_stored, marker] when every piece is
    # already present, or [:ready, marker] when every piece integrates in order
    # with nothing left pending.
    def validate_split_updates(document, updates, generation:, payload:)
      ydoc, marker = load_integrated_doc_for_split(document, generation:, payload:)

      if updates.all? { |update| ydoc.update_ready?(update) && !ydoc.update_advances?(update) }
        return [ :already_stored, marker ]
      end

      updates.each do |update|
        sv = decode_state_vector(ydoc.encode_state_vector)
        unless contiguous_with_state?(update, sv)
          payload[:outcome] = "rejected_incomplete"
          raise ArgumentError, "incomplete split Yjs update for document #{document.id}"
        end
        ydoc.apply_update(update)
        if ydoc.update_advances?(update)
          payload[:outcome] = "rejected_incomplete"
          raise ArgumentError, "incomplete split Yjs update for document #{document.id}"
        end
      end

      if ydoc.pending? || !updates.all? { |update| ydoc.update_ready?(update) }
        payload[:outcome] = "rejected_incomplete"
        raise ArgumentError, "incomplete split Yjs update for document #{document.id}"
      end

      [ :ready, marker ]
    end

    def load_integrated_doc_for_split(document, generation:, payload:, healed: false)
      tail_rows = YjsDocumentUpdate.where(document_id: document.id).order(:id).to_a
      document.reload
      unless generation == document.content_generation
        payload[:outcome] = "rejected_stale"
        raise Document::StaleGenerationError,
              "Client generation #{generation} is behind document generation #{document.content_generation}."
      end

      ydoc = load_ydoc(document)
      marker = [ document.yjs_state_checksum, document.yjs_state.present? ]

      tail_rows.each do |row|
        next unless row.content_generation == document.content_generation

        begin
          ydoc.apply_update(row.payload)
        rescue StandardError
          # Poison-pill rows are quarantined on the next fold.
        end
      end

      if ydoc.pending?
        compacted = load_verified_blob(ydoc.compacted_state_update)
        ydoc = compacted if compacted
      end

      [ ydoc, marker ]
    rescue CorruptStateError => e
      raise if healed

      with_document_lock(document) do
        YjsRecovery.heal_corrupt_state!(document, e)
      end
      load_integrated_doc_for_split(document, generation:, payload:, healed: true)
    end

    def contiguous_with_state?(update, state_vector)
      client_count, index = decode_var_uint(update, 0)
      return true if client_count.zero? || client_count > 1

      struct_count, index = decode_var_uint(update, index)
      return true if struct_count.zero?

      client_id, index = decode_var_uint(update, index)
      first_clock, = decode_var_uint(update, index)
      first_clock <= state_vector.fetch(client_id, 0)
    end

    def load_verified_blob(blob)
      ydoc = Y::Doc.new
      ydoc.apply_update(blob)
      ydoc
    rescue StandardError
      nil
    end

    # Order-independent structural fingerprint of a gap-free Y::Doc's
    # materialized state: [state_vector_hash, delete_set_hash]. Comparing
    # fingerprints instead of raw bytes prevents phantom rewrites when yrs
    # serializes multi-client HashMaps in a different order across docs or
    # processes, while still detecting delete-only folds (which leave the
    # state vector unchanged). Returns nil when the doc has pending updates.
    def state_fingerprint(ydoc)
      return nil if ydoc.pending?

      sv = ydoc.encode_state_vector
      [ decode_state_vector(sv), decode_delete_set(ydoc.encode_state_as_update(sv)) ]
    end

    # Serve a handshake that includes unfolded tail rows: acquire both
    # locks, fold, and encode from the materialized doc. The doc (not the
    # columns) is authoritative here so a degraded fold — one that could
    # not persist — still serves clients the complete state.
    def fold_and_encode_handshake(document, payload)
      with_document_lock(document) do
        ydoc = perform_fold(document)
        payload[:served_from] = "fold"
        payload[:blob_bytes] = document.yjs_state&.bytesize || 0
        encode_ydoc_b64(ydoc)
      end
    end

    def load_ydoc(document)
      ydoc = Y::Doc.new
      if document.yjs_state.present?
        YjsRecovery.verify_checksum!(document)
        begin
          ydoc.apply_update(document.yjs_state)
        rescue StandardError => e
          raise CorruptStateError, "document #{document.id}: #{e.class}: #{e.message}"
        end
      end
      ydoc
    end

    def encode_ydoc_b64(ydoc)
      [
        Base64.strict_encode64(ydoc.compacted_state_update),
        Base64.strict_encode64(ydoc.encode_state_vector)
      ]
    end

    def encode_ydoc_diff_b64(ydoc, client_sv)
      [
        Base64.strict_encode64(ydoc.encode_state_as_update(client_sv)),
        Base64.strict_encode64(ydoc.encode_state_vector)
      ]
    rescue Y::Error
      encode_ydoc_b64(ydoc)
    end

    def decode_client_state_vector(client_sv_b64)
      return nil if client_sv_b64.blank? || client_sv_b64.bytesize > MAX_STATE_VECTOR_B64_BYTES

      bytes = decode(client_sv_b64)
      return nil if bytes.empty? || bytes.bytesize > MAX_STATE_VECTOR_BYTES

      decode_state_vector(bytes)
      bytes
    rescue ArgumentError
      nil
    end

    def fold_and_encode_diff(document, client_sv, payload)
      with_document_lock(document) do
        ydoc = perform_fold(document)
        payload[:served_from] = "diff_fold"
        payload[:blob_bytes] = document.yjs_state&.bytesize || 0
        encode_ydoc_diff_b64(ydoc, client_sv)
      end
    end

    def encode_diff(document, client_sv, payload)
      payload[:blob_bytes] = document.yjs_state&.bytesize || 0
      if document.yjs_state.blank?
        payload[:served_from] = "diff_empty"
        return [
          Base64.strict_encode64(EMPTY_UPDATE),
          Base64.strict_encode64(EMPTY_STATE_VECTOR)
        ]
      end

      payload[:served_from] = "diff"
      encode_ydoc_diff_b64(load_ydoc(document), client_sv)
    end

    def heal_and_reencode_diff(document, client_sv, payload)
      with_document_lock(document) do
        begin
          encode_diff(document, client_sv, payload)
        rescue CorruptStateError => e
          YjsRecovery.heal_corrupt_state!(document, e)
          encode_diff(document, client_sv, payload)
        end
      end
    end
    def encode_handshake(document, payload)
      payload[:blob_bytes] = document.yjs_state&.bytesize || 0
      from_columns = document.yjs_state.present? && document.yjs_state_vector.present?
      payload[:served_from] = from_columns ? "columns" : "rebuild"
      if from_columns
        YjsRecovery.verify_checksum!(document)
        # Legacy rows carry no checksum yet, so probe loadability before
        # serving — otherwise a corrupt pre-migration blob would be relayed
        # verbatim on every join with no heal. The probe cost lasts only
        # until the row's next merge stamps a checksum.
        if document.yjs_state_checksum.blank? && !blob_loadable?(document.yjs_state)
          raise CorruptStateError, "document #{document.id}: stored blob is not loadable"
        end
        [
          Base64.strict_encode64(document.yjs_state),
          Base64.strict_encode64(document.yjs_state_vector)
        ]
      else
        encode_ydoc_b64(load_ydoc(document))
      end
    end

    # The handshake fast path holds no locks, so corruption is healed here:
    # acquire both, re-check (another thread may have healed first), heal,
    # and rebuild the handshake from the restored state.
    def heal_and_reencode_handshake(document, payload)
      with_document_lock(document) do
        begin
          encode_handshake(document, payload)
        rescue CorruptStateError => e
          YjsRecovery.heal_corrupt_state!(document, e)
          encode_handshake(document, payload)
        end
      end
    end

    # Stored vector when present; otherwise derive from the blob (legacy rows).
    def server_state_vector(document)
      return document.yjs_state_vector if document.yjs_state_vector.present?

      load_ydoc(document).encode_state_vector
    end

    def decode(base64_update)
      Base64.strict_decode64(base64_update)
    end

    # Yjs state vectors are lib0 varUint maps of client id => clock. Decode
    # them directly so the snapshot staleness gate stays zero-Y::Doc on the
    # fast path and handles multi-client vectors in any entry order.
    def decode_state_vector(bytes)
      count, index = decode_var_uint(bytes, 0)
      count.times.each_with_object({}) do |_entry, clocks|
        client_id, index = decode_var_uint(bytes, index)
        clock, index = decode_var_uint(bytes, index)
        clocks[client_id] = clock
      end
    end

    # Decode the delete-set portion of an empty-struct Yjs v1 update
    # (produced by encode_state_as_update(current_state_vector)) into an
    # order-independent { client_id => [[clock, len], ...] } map.
    def decode_delete_set(bytes)
      struct_clients, index = decode_var_uint(bytes, 0)
      raise ArgumentError, "unexpected structs in delete-set diff" unless struct_clients.zero?

      client_count, index = decode_var_uint(bytes, index)
      client_count.times.each_with_object({}) do |_entry, deletes|
        client_id, index = decode_var_uint(bytes, index)
        range_count, index = decode_var_uint(bytes, index)
        deletes[client_id] = range_count.times.map do
          clock, index = decode_var_uint(bytes, index)
          length, index = decode_var_uint(bytes, index)
          [ clock, length ]
        end
      end
    end

    def decode_var_uint(bytes, index)
      value = 0
      shift = 0
      loop do
        byte = bytes.getbyte(index)
        raise ArgumentError, "truncated state vector" if byte.nil?

        index += 1
        value |= (byte & 0x7f) << shift
        return [ value, index ] if (byte & 0x80).zero?

        shift += 7
        raise ArgumentError, "invalid state vector" if shift > 63
      end
    end

    def lock_for(document_id)
      LOCKS[document_id % LOCK_STRIPES]
    end
  end
end
