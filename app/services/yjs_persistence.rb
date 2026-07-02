# Server-side Yjs state handling via y-rb (Rust yrs bindings). The server never
# interprets document structure — it blindly merges binary updates (commutative,
# idempotent) into the stored blob and serves the merged state + state vector to
# joining clients. See README for why we relay manually instead of using
# y-rb_actioncable's channel.
class YjsPersistence
  # Raised when a stored blob fails its checksum or cannot be synced into a
  # fresh doc. Callers holding the document locks heal via
  # heal_corrupt_state! and retry.
  class CorruptStateError < StandardError; end

  # Per-document, in-process locks. ActionCable handles channel actions on a
  # thread pool; without this, two concurrent receives could both read the same
  # stored blob and the later write would drop the earlier update. The app runs
  # single-process in development (async cable adapter), so an in-process lock
  # is sufficient; the DB transaction below is the second guard.
  LOCKS = Concurrent::Map.new

  # A fold archives the pre-fold state at most this often per document,
  # bounding what a corrupt-blob heal can lose to one interval of edits.
  CHECKPOINT_INTERVAL = 10.minutes

  # A merge triggers an inline fold when the tail reaches this many rows,
  # bounding tail growth during long sessions with no joins or disconnects.
  FOLD_THRESHOLD = 64

  # A retained (pending) log row whose causal dependency never arrives is an
  # orphan: after this long it is quarantined to yjs_state_archives instead
  # of being refolded forever or silently dropped.
  ORPHAN_TTL = 1.hour

  # The byte signature of an exactly-empty v1 update (zero structs, zero
  # deletes) — what a joining client with nothing new sends as sync-reply.
  EMPTY_UPDATE = [ 0, 0 ].freeze

  class << self
    # Merge a base64-encoded Yjs update into the document's persisted state.
    #
    # `generation` is the sending client's last-known Document#content_generation
    # (nil for clients deployed before this field existed — trusted, matching
    # the channel's existing seq-less rollout-compatibility behavior). A
    # present generation behind the document's current one means an owner CLI
    # replacement (Document#replace_content!) reset this document's live
    # state since the client last synced: merging would resurrect the exact
    # CRDT content the replacement just wiped, so the update is rejected
    # rather than persisted.
    def merge(document, base64_update, generation: nil, token: nil, user: nil)
      update = decode(base64_update)
      ActiveSupport::Notifications.instrument(
        "merge.yjs", document_id: document.id, update_bytes: update.length
      ) do |payload|
        entered_at = monotonic_ms
        lock_for(document.id).synchronize do
          document.with_lock do
            payload[:lock_wait_ms] = (monotonic_ms - entered_at).round(1)
            document.reload
            unless document.writable_by?(token, user:)
              payload[:outcome] = "rejected_locked"
              raise Document::EditingLockedError, "This document is read-only."
            end
            if generation && generation != document.content_generation
              payload[:outcome] = "rejected_stale"
              raise Document::StaleGenerationError,
                    "Client generation #{generation} is behind document generation #{document.content_generation}."
            end

            # The empty update (a joining client's sync-reply when it has
            # nothing new) must not append — flipping seed_state to
            # "seeded" without content would permanently block the seed
            # claim, and every join would bloat the log otherwise.
            if update == EMPTY_UPDATE
              payload[:outcome] = "noop"
              next
            end

            # An undecodable update must be rejected before it becomes
            # durable: appended garbage would flip seed_state, broadcast to
            # peers, and clog every future fold. The probe is O(update) on
            # a fresh doc — updates with unmet causal dependencies park
            # cleanly and do not raise.
            unless decodable_update?(update)
              payload[:outcome] = "rejected_undecodable"
              raise ArgumentError, "undecodable Yjs update for document #{document.id}"
            end

            # The durable act: an O(update) append. No Y::Doc is built on
            # this path — folds materialize the tail into the snapshot
            # columns on joins, thresholds, and disconnects.
            document.yjs_document_updates.create!(
              content_generation: document.content_generation,
              payload: update.pack("C*")
            )
            unless document.seed_state == "seeded"
              document.update_columns(seed_state: "seeded", updated_at: Time.current)
            end
            payload[:outcome] = "appended"
            payload[:tail_rows] = document.yjs_document_updates.count
            perform_fold(document) if payload[:tail_rows] >= FOLD_THRESHOLD
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

        lock_for(document.id).synchronize do
          document.with_lock do
            document.reload
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
                decode_state_vector(load_or_heal_ydoc(document).state)
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

      lock_for(document.id).synchronize do
        document.with_lock do
          document.reload
          perform_fold(document)
        end
      end
    end

    private

    def monotonic_ms
      Process.clock_gettime(Process::CLOCK_MONOTONIC, :float_millisecond)
    end

    # Materialize snapshot + tail and persist, deleting only rows provably
    # incorporated. Callers must hold both locks. Returns the folded doc.
    #
    # Row classification (deletions live in the delete set and do not
    # advance the state vector, so the vector alone cannot prove
    # incorporation):
    # - older generation      -> delete (a replacement wiped that state)
    # - advanced the vector   -> integrated, delete
    # - zero-struct payload   -> a pure delete-set frame; its deletes either
    #   applied to known structs or reference content the server never had
    #   (a moot tombstone) — integrated, delete
    # - struct-carrying, vector unchanged, self-contained -> duplicate of
    #   snapshot content, delete
    # - otherwise -> pending structs whose causal dependency has not
    #   arrived; retain for the next fold, quarantine after ORPHAN_TTL
    #   rather than refolding forever or dropping silently
    #
    # Known residual: a single frame mixing already-integrated structs with
    # structs pending on a missing cross-client dependency classifies as
    # integrated (the vector advanced) and its pending half is dropped by
    # full_diff — the same window the pre-log architecture had on every
    # merge; per-client frame ordering upstream makes it equally rare here.
    def perform_fold(document)
      rows = document.yjs_document_updates.order(:id).to_a
      return load_or_heal_ydoc(document) if rows.empty?

      ActiveSupport::Notifications.instrument("fold.yjs", document_id: document.id, rows: rows.length) do |payload|
        ydoc = load_or_heal_ydoc(document)
        integrated_ids = []
        retained = []

        rows.each do |row|
          if row.content_generation != document.content_generation
            integrated_ids << row.id
            next
          end

          before = ydoc.state
          begin
            ydoc.sync(row.payload.unpack("C*"))
          rescue StandardError
            retained << row # undecodable row: TTL quarantine below
            next
          end
          if ydoc.state != before || zero_struct_update?(row.payload) || self_contained_update?(row.payload)
            integrated_ids << row.id
          else
            retained << row
          end
        end

        quarantine_orphans(document, retained)
        payload[:integrated] = integrated_ids.length
        payload[:retained] = retained.length

        # The blob (not the vector) is the persistence signal: delete-only
        # folds change the encoded delete set without advancing the vector.
        # A truly empty doc (only stale/retained rows on a never-folded
        # document) must not persist the empty encoding — a present-but-empty
        # yjs_state would block seed claims.
        blob = ydoc.full_diff.pack("C*")
        still_empty = document.yjs_state.nil? && blob == EMPTY_UPDATE.pack("C*")
        if blob != document.yjs_state && !still_empty
          payload[:blob_bytes_after] = blob.bytesize
          unless blob_loadable?(blob)
            # Serve clients from the in-memory doc but never persist a blob
            # that would brick future loads; rows stay for the next fold.
            payload[:outcome] = "invalid_encode"
            return ydoc
          end

          maybe_checkpoint(document)
          document.update_columns(
            yjs_state: blob,
            yjs_state_vector: ydoc.state.pack("C*"),
            yjs_state_checksum: state_checksum(blob),
            updated_at: Time.current
          )
        end

        document.yjs_document_updates.where(id: integrated_ids).delete_all if integrated_ids.any?
        payload[:outcome] = "folded"
        ydoc
      end
    end

    # A v1 update whose struct count is zero carries only a delete set —
    # the shape of a backspace-only frame or a joiner's sync-reply echo on
    # a document with deletion history.
    def zero_struct_update?(blob)
      count, = decode_var_uint(blob.unpack("C*"), 0)
      count.zero?
    rescue ArgumentError
      false
    end

    # A vector-unchanged row whose structs apply cleanly to a fresh doc is
    # dependency-free, so the fold's snapshot must already contain it — a
    # duplicate. Structs that stay pending on a fresh doc were pending in
    # the fold too.
    def self_contained_update?(blob)
      probe = Y::Doc.new
      base = probe.state
      probe.sync(blob.unpack("C*"))
      probe.state != base
    rescue StandardError
      false
    end

    # Updates with unmet causal dependencies park cleanly; genuine garbage
    # raises inside yrs.
    def decodable_update?(update)
      Y::Doc.new.sync(update)
      true
    rescue StandardError
      false
    end

    def quarantine_orphans(document, retained)
      orphans = retained.select { |row| row.created_at < ORPHAN_TTL.ago }
      return if orphans.empty?

      orphans.each do |row|
        document.yjs_state_archives.create!(
          kind: YjsStateArchive::ORPHAN,
          content_generation: row.content_generation,
          yjs_state: row.payload,
          error: "orphaned pending update: causal dependency never arrived"
        )
      end
      YjsStateArchive.prune!(document, YjsStateArchive::ORPHAN)
      document.yjs_document_updates.where(id: orphans.map(&:id)).delete_all
      retained.reject! { |row| orphans.include?(row) }
    end

    # Serve a handshake that includes unfolded tail rows: acquire both
    # locks, fold, and encode from the materialized doc. The doc (not the
    # columns) is authoritative here so a degraded fold — one that could
    # not persist — still serves clients the complete state.
    def fold_and_encode_handshake(document, payload)
      lock_for(document.id).synchronize do
        document.with_lock do
          document.reload
          ydoc = perform_fold(document)
          payload[:served_from] = "fold"
          payload[:blob_bytes] = document.yjs_state&.bytesize || 0
          encode_ydoc_b64(ydoc)
        end
      end
    end

    def load_ydoc(document)
      ydoc = Y::Doc.new
      if document.yjs_state.present?
        verify_checksum!(document)
        begin
          ydoc.sync(document.yjs_state.unpack("C*"))
        rescue StandardError => e
          raise CorruptStateError, "document #{document.id}: #{e.class}: #{e.message}"
        end
      end
      ydoc
    end

    # For callers already holding both document locks (merge,
    # persist_snapshot): a corrupt blob heals in place and the load retries
    # once on the restored state.
    def load_or_heal_ydoc(document)
      load_ydoc(document)
    rescue CorruptStateError => e
      heal_corrupt_state!(document, e)
      load_ydoc(document)
    end

    def verify_checksum!(document)
      checksum = document.yjs_state_checksum
      return if checksum.blank? # legacy row — heals on its next merge
      return if checksum == state_checksum(document.yjs_state)

      raise CorruptStateError, "document #{document.id}: yjs_state checksum mismatch"
    end

    def encode_ydoc_b64(ydoc)
      [
        Base64.strict_encode64(ydoc.full_diff.pack("C*")),
        Base64.strict_encode64(ydoc.state.pack("C*"))
      ]
    end

    def state_checksum(blob)
      Digest::SHA256.hexdigest(blob)
    end

    def blob_loadable?(blob)
      Y::Doc.new.sync(blob.unpack("C*"))
      true
    rescue StandardError
      false
    end

    def encode_handshake(document, payload)
      payload[:blob_bytes] = document.yjs_state&.bytesize || 0
      from_columns = document.yjs_state.present? && document.yjs_state_vector.present?
      payload[:served_from] = from_columns ? "columns" : "rebuild"
      if from_columns
        verify_checksum!(document)
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
      lock_for(document.id).synchronize do
        document.with_lock do
          document.reload
          begin
            encode_handshake(document, payload)
          rescue CorruptStateError => e
            heal_corrupt_state!(document, e)
            encode_handshake(document, payload)
          end
        end
      end
    end

    # Contain-and-restore for a corrupt stored blob. Callers must hold both
    # the per-document mutex and the row lock. The corrupt bytes are
    # quarantined for forensics, then the newest loadable checkpoint from
    # the *current* content generation is restored — never an older
    # generation, which would resurrect content a replacement wiped. With
    # no restorable checkpoint the document degrades to empty and connected
    # clients re-upload their state through the sync-reply handshake.
    def heal_corrupt_state!(document, error)
      ActiveSupport::Notifications.instrument("recovered.yjs", document_id: document.id) do |payload|
        # A loadable blob with a mismatched checksum is not corruption — it
        # is a write from a pre-checksum code version (mixed-version deploy
        # window or rollback). Re-stamp instead of destroying healthy state.
        if document.yjs_state.present? && blob_loadable?(document.yjs_state)
          document.update_columns(
            yjs_state_checksum: state_checksum(document.yjs_state),
            updated_at: Time.current
          )
          payload[:restored_from] = "restamped"
          payload[:outcome] = "recovered"
          return
        end

        YjsStateArchive.record!(document, kind: YjsStateArchive::QUARANTINE, error: error.message)

        checkpoint = document.yjs_state_archives
                             .where(kind: YjsStateArchive::CHECKPOINT, content_generation: document.content_generation)
                             .order(created_at: :desc, id: :desc)
                             .detect { |archive| archive.yjs_state.present? && blob_loadable?(archive.yjs_state) }
        if checkpoint
          document.update_columns(
            yjs_state: checkpoint.yjs_state,
            yjs_state_vector: checkpoint.yjs_state_vector,
            yjs_state_checksum: state_checksum(checkpoint.yjs_state),
            updated_at: Time.current
          )
          payload[:restored_from] = "checkpoint"
        else
          document.update_columns(
            yjs_state: nil,
            yjs_state_vector: nil,
            yjs_state_checksum: nil,
            updated_at: Time.current
          )
          payload[:restored_from] = "empty"
        end
        payload[:outcome] = "recovered"
      end
    end

    # Interval-gated archive of the pre-fold state, bounding what a future
    # heal can lose to at most one interval of edits. Caller holds both locks.
    def maybe_checkpoint(document)
      return if document.yjs_state.blank?

      newest = document.yjs_state_archives
                       .where(kind: YjsStateArchive::CHECKPOINT, content_generation: document.content_generation)
                       .maximum(:created_at)
      return if newest && newest > CHECKPOINT_INTERVAL.ago

      YjsStateArchive.record!(document, kind: YjsStateArchive::CHECKPOINT)
    end

    # Stored vector when present; otherwise derive from the blob (legacy rows).
    def server_state_vector(document)
      return document.yjs_state_vector.unpack("C*") if document.yjs_state_vector.present?

      load_ydoc(document).state
    end

    def decode(base64_update)
      Base64.strict_decode64(base64_update).unpack("C*")
    end

    # Yjs state vectors are lib0 varUint maps of client id => clock. Decode
    # them directly: y-rb's diff binding can misread a valid multi-client
    # vector when JavaScript emits the map entries in a different order.
    def decode_state_vector(bytes)
      count, index = decode_var_uint(bytes, 0)
      count.times.each_with_object({}) do |_entry, clocks|
        client_id, index = decode_var_uint(bytes, index)
        clock, index = decode_var_uint(bytes, index)
        clocks[client_id] = clock
      end
    end

    def decode_var_uint(bytes, index)
      value = 0
      shift = 0
      loop do
        byte = bytes.fetch(index)
        index += 1
        value |= (byte & 0x7f) << shift
        return [ value, index ] if (byte & 0x80).zero?

        shift += 7
        raise ArgumentError, "invalid state vector" if shift > 63
      end
    rescue IndexError
      raise ArgumentError, "truncated state vector"
    end

    def lock_for(document_id)
      LOCKS.compute_if_absent(document_id) { Mutex.new }
    end
  end
end
