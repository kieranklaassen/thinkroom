# Server-side Yjs state handling via y-rb (Rust yrs bindings). The server never
# interprets document structure — it blindly merges binary updates (commutative,
# idempotent) into the stored blob and serves the merged state + state vector to
# joining clients. See README for why we relay manually instead of using
# y-rb_actioncable's channel.
class YjsPersistence
  # Per-document, in-process locks. ActionCable handles channel actions on a
  # thread pool; without this, two concurrent receives could both read the same
  # stored blob and the later write would drop the earlier update. The app runs
  # single-process in development (async cable adapter), so an in-process lock
  # is sufficient; the DB transaction below is the second guard.
  LOCKS = Concurrent::Map.new

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

            ydoc = load_ydoc(document)
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
            document.update_columns(
              yjs_state: blob,
              yjs_state_vector: ydoc.state.pack("C*"),
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
        payload[:blob_bytes] = document.yjs_state&.bytesize || 0
        from_columns = document.yjs_state.present? && document.yjs_state_vector.present?
        payload[:served_from] = from_columns ? "columns" : "rebuild"
        encoded =
          if from_columns
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
                decode_state_vector(load_ydoc(document).state)
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
      ydoc.sync(document.yjs_state.unpack("C*")) if document.yjs_state.present?
      ydoc
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
