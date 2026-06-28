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
    # Returns true when the frame belongs to the current content generation
    # (and was therefore relayable), false when it was dropped as stale.
    #
    # `epoch` is the document generation the sending client last synced at.
    # When the source was replaced (replace_content! bumps crdt_epoch), frames
    # produced from the superseded generation must not resurrect the old CRDT
    # state — a reconnecting client's sync-reply would otherwise dump its entire
    # pre-reset document back into the freshly reset doc. A nil epoch is treated
    # as generation 0 (legacy/rollout clients): harmless on never-reset docs,
    # correctly dropped on docs that have since been replaced.
    def merge(document, base64_update, token: nil, user: nil, epoch: nil)
      update = decode(base64_update)
      relayable = false
      lock_for(document.id).synchronize do
        document.with_lock do
          document.reload
          raise Document::EditingLockedError, "This document is read-only." unless document.writable_by?(token, user:)
          # A frame stamped with a generation older than the document's current
          # one was produced before a replace_content! reset; dropping it keeps
          # the old CRDT state from coming back. nil/absent stamps count as
          # generation 0, so never-reset docs (crdt_epoch 0) accept everything.
          next if document.crdt_epoch > epoch.to_i

          relayable = true
          ydoc = load_ydoc(document)
          before = ydoc.state
          ydoc.sync(update)
          # A no-op update (e.g. the empty sync-reply a client joining an
          # empty doc sends) must not persist — flipping seed_state to
          # "seeded" without content would permanently block the seed claim.
          next if ydoc.state == before

          document.update_columns(
            yjs_state: ydoc.full_diff.pack("C*"),
            seed_state: "seeded",
            updated_at: Time.current
          )
        end
      end
      relayable
    end

    # => [full_state_b64, state_vector_b64] for the sync handshake.
    def state_b64(document)
      ydoc = load_ydoc(document)
      [
        Base64.strict_encode64(ydoc.full_diff.pack("C*")),
        Base64.strict_encode64(ydoc.state.pack("C*"))
      ]
    end

    # Persist a derived source/provenance snapshot only when the submitting
    # client has observed every Yjs update currently stored by the server.
    # A client may be ahead (its own cable frame is still in flight), but it
    # may not overwrite the API read model from behind.
    def persist_snapshot(document, state_vector_b64:, content:, spans:, title: document.title,
                         token: nil, user: nil, epoch: nil)
      client_state = decode_state_vector(decode(state_vector_b64)) if state_vector_b64.present?

      lock_for(document.id).synchronize do
        document.with_lock do
          document.reload
          raise Document::EditingLockedError, "This document is read-only." unless document.writable_by?(token, user:)
          # Re-check the generation under the write lock, not just in the
          # controller: a replace_content! can commit between the unlocked read
          # and this write, and the currency check below is skipped once the
          # reset nils yjs_state — without this a stale snapshot would overwrite
          # the read model after the reset. nil epoch counts as generation 0.
          return false if document.crdt_epoch > epoch.to_i

          if client_state && document.yjs_state.present?
            server_state = decode_state_vector(load_ydoc(document).state)
            current = server_state.all? do |client_id, clock|
              client_state.fetch(client_id, 0) >= clock
            end
            return false unless current
          end

          document.update!(title:, content_snapshot: content, provenance_spans: spans)
        end
      end
      true
    rescue ArgumentError
      false
    end

    private

    def load_ydoc(document)
      ydoc = Y::Doc.new
      ydoc.sync(document.yjs_state.unpack("C*")) if document.yjs_state.present?
      ydoc
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
