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
    def merge(document, base64_update)
      update = decode(base64_update)
      lock_for(document.id).synchronize do
        document.with_lock do
          ydoc = load_ydoc(document.reload)
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
    end

    # => [full_state_b64, state_vector_b64] for the sync handshake.
    def state_b64(document)
      ydoc = load_ydoc(document)
      [
        Base64.strict_encode64(ydoc.full_diff.pack("C*")),
        Base64.strict_encode64(ydoc.state.pack("C*"))
      ]
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

    def lock_for(document_id)
      LOCKS.compute_if_absent(document_id) { Mutex.new }
    end
  end
end
