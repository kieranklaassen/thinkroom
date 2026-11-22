# In-process ephemeral cache of each active SyncChannel subscriber's latest
# Yjs awareness frame, keyed per document and subscriber.
#
# Joining subscribers receive all other active peers' cached awareness frames
# directly from the server during SyncChannel#subscribed — eliminating the
# O(N^2) awareness-query broadcast storm on join. Disconnecting subscribers are
# evicted immediately so SyncChannel#unsubscribed can broadcast an explicit
# peer-left signal instead of letting closed or crashed tabs linger until
# y-protocols' 30s timeout. Entries for a document are removed wholesale when
# its last subscriber disconnects.
class YjsAwarenessCache
  # Awareness frames carry small presence payloads (name, color, cursor anchor,
  # viewport, read pointer). Capping at 4 KiB blocks memory/bandwidth abuse
  # without affecting legitimate presence state.
  MAX_AWARENESS_BYTES = 4.kilobytes
  MAX_AWARENESS_B64_BYTES = ((MAX_AWARENESS_BYTES + 2) / 3) * 4

  Entry = Data.define(:update, :cid, :client_id)

  # document_id => Concurrent::Map(subscriber_key => Entry)
  STORE = Concurrent::Map.new

  class << self
    # Store a validated awareness frame for a subscriber.
    def put(document_id, subscriber_key, update:, cid:, client_id: nil)
      STORE.compute(document_id) do |entries|
        map = entries || Concurrent::Map.new
        map[subscriber_key] = Entry.new(update:, cid:, client_id:)
        map
      end
    end

    # Return cached entries for all other active subscribers on the document.
    # Excludes the caller's own subscriber_key (and matching cid, e.g. when a
    # tab reconnects before its previous socket finishes unsubscribing).
    def peers_for(document_id, exclude_key: nil, exclude_cid: nil)
      entries = STORE[document_id]
      return [] unless entries

      peers = []
      entries.each_pair do |key, entry|
        next if exclude_key && key == exclude_key
        next if exclude_cid.present? && entry.cid == exclude_cid

        peers << entry
      end
      peers
    end

    # Remove a single subscriber's cached awareness and return its previous
    # Entry (or nil if it never published awareness). Drops the document bucket
    # if it becomes empty.
    def remove(document_id, subscriber_key)
      removed = nil
      STORE.compute(document_id) do |entries|
        next nil unless entries

        removed = entries.delete(subscriber_key)
        entries.empty? ? nil : entries
      end
      removed
    end

    # True when another active subscriber on the same document currently holds
    # the given Yjs client_id (guards against a reconnected tab's closing zombie
    # socket evicting its live successor).
    def active_client_id?(document_id, client_id)
      return false if client_id.nil?

      entries = STORE[document_id]
      return false unless entries

      entries.each_value do |entry|
        return true if entry.client_id == client_id
      end
      false
    end

    # Drop all cached awareness for a document (called when its last subscriber
    # disconnects).
    def clear_document(document_id)
      STORE.delete(document_id)
    end

    # Clear the entire cache (used in test setup).
    def clear
      STORE.clear
    end

    # Extract the Yjs clientID from a lib0-encoded awareness update when the
    # update carries a single client entry. Returns nil on malformed or
    # multi-client frames so callers never raise on untrusted wire bytes.
    def extract_client_id(decoded_bytes)
      count, index = read_var_uint(decoded_bytes, 0)
      return nil unless count == 1

      client_id, = read_var_uint(decoded_bytes, index)
      client_id
    rescue ArgumentError
      nil
    end

    private

    def read_var_uint(bytes, index)
      value = 0
      shift = 0
      loop do
        byte = bytes.getbyte(index)
        raise ArgumentError, "truncated awareness frame" if byte.nil?

        index += 1
        value |= (byte & 0x7f) << shift
        return [ value, index ] if (byte & 0x80).zero?

        shift += 7
        raise ArgumentError, "invalid varint in awareness frame" if shift > 63
      end
    end
  end
end
