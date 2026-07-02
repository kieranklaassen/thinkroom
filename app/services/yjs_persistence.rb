# Server-side Yjs state handling via y-rb (Rust yrs bindings). The server never
# interprets document structure — it blindly merges binary updates (commutative,
# idempotent) into the stored blob and serves the merged state + state vector to
# joining clients. See README for why we relay manually instead of using
# y-rb_actioncable's channel.
class YjsPersistence
  # Raised when a freshly encoded blob fails the round-trip probe: persisting
  # it would brick every future load, so the frame is rejected instead
  # (SyncChannel's rescue keeps it unbroadcast — durable-before-broadcast).
  class EncodeValidationError < StandardError; end

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

  # A merge archives the pre-merge state at most this often per document,
  # bounding what a corrupt-blob heal can lose to one interval of edits.
  CHECKPOINT_INTERVAL = 10.minutes

  # Newest archives kept per document and kind.
  MAX_ARCHIVES_PER_KIND = 5

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

            ydoc = load_or_heal_ydoc(document)
            before = ydoc.state
            ydoc.sync(update)
            # A no-op update (e.g. the empty sync-reply a client joining an
            # empty doc sends) must not persist — flipping seed_state to
            # "seeded" without content would permanently block the seed claim.
            if ydoc.state == before
              payload[:outcome] = "noop"
              next
            end

            payload[:blob_bytes_before] = document.yjs_state&.bytesize || 0
            blob = ydoc.full_diff.pack("C*")
            payload[:blob_bytes_after] = blob.bytesize
            unless blob_loadable?(blob)
              payload[:outcome] = "rejected_invalid_encode"
              raise EncodeValidationError,
                    "Refusing to persist a blob that cannot round-trip into a fresh doc " \
                    "(document #{document.id})."
            end

            maybe_checkpoint(document)
            document.update_columns(
              yjs_state: blob,
              yjs_state_vector: ydoc.state.pack("C*"),
              yjs_state_checksum: Digest::SHA256.hexdigest(blob),
              seed_state: "seeded",
              updated_at: Time.current
            )
            payload[:outcome] = "merged"
            true
          end
        end
      end
    end

    # => [full_state_b64, state_vector_b64] for the sync handshake.
    #
    # The stored blob is exactly the previous merge's full_diff output and
    # the stored vector its state, so when both columns are present the
    # handshake is served from them directly — no Y::Doc instantiation.
    # Documents written before yjs_state_vector existed (blob present,
    # vector nil) fall back to rebuilding; their next merge heals them.
    def state_b64(document)
      ActiveSupport::Notifications.instrument("state.yjs", document_id: document.id) do |payload|
        encoded = begin
          encode_handshake(document, payload)
        rescue CorruptStateError => e
          # The fast path holds no locks, so corruption is healed here:
          # acquire both, re-check (another thread may have healed first),
          # heal, and rebuild the handshake from the restored state.
          lock_for(document.id).synchronize do
            document.with_lock do
              document.reload
              begin
                encode_handshake(document, payload)
              rescue CorruptStateError
                heal_corrupt_state!(document, e)
                encode_handshake(document, payload)
              end
            end
          end
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
    def persist_snapshot(document, state_vector_b64:, content:, spans:, title: document.title,
                         token: nil, user: nil)
      ActiveSupport::Notifications.instrument("snapshot.yjs", document_id: document.id) do |payload|
        client_state = decode_state_vector(decode(state_vector_b64)) if state_vector_b64.present?

        lock_for(document.id).synchronize do
          document.with_lock do
            document.reload
            unless document.writable_by?(token, user:)
              payload[:outcome] = "rejected_locked"
              raise Document::EditingLockedError, "This document is read-only."
            end

            if client_state && document.yjs_state.present?
              server_state = begin
                decode_state_vector(server_state_vector(document))
              rescue ArgumentError
                # A corrupt stored vector must not masquerade as client
                # staleness — derive the truth from the blob instead.
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

            document.update!(title:, content_snapshot: content, provenance_spans: spans)
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

    private

    def monotonic_ms
      Process.clock_gettime(Process::CLOCK_MONOTONIC, :float_millisecond)
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
      return if checksum == Digest::SHA256.hexdigest(document.yjs_state)

      raise CorruptStateError, "document #{document.id}: yjs_state checksum mismatch"
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
        [
          Base64.strict_encode64(document.yjs_state),
          Base64.strict_encode64(document.yjs_state_vector)
        ]
      else
        ydoc = load_ydoc(document)
        [
          Base64.strict_encode64(ydoc.full_diff.pack("C*")),
          Base64.strict_encode64(ydoc.state.pack("C*"))
        ]
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
        YjsStateArchive.record!(document, kind: "quarantine", error: error.message)

        checkpoint = document.yjs_state_archives
                             .where(kind: "checkpoint", content_generation: document.content_generation)
                             .order(created_at: :desc, id: :desc)
                             .detect { |archive| archive.yjs_state.present? && blob_loadable?(archive.yjs_state) }
        if checkpoint
          document.update_columns(
            yjs_state: checkpoint.yjs_state,
            yjs_state_vector: checkpoint.yjs_state_vector,
            yjs_state_checksum: Digest::SHA256.hexdigest(checkpoint.yjs_state),
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

    # Interval-gated archive of the pre-merge state, bounding what a future
    # heal can lose to at most one interval of edits. Caller holds both locks.
    def maybe_checkpoint(document)
      return if document.yjs_state.blank?

      newest = document.yjs_state_archives.where(kind: "checkpoint").maximum(:created_at)
      return if newest && newest > CHECKPOINT_INTERVAL.ago

      YjsStateArchive.record!(document, kind: "checkpoint")
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
