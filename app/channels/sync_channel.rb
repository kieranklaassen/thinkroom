# Relays Yjs CRDT messages between clients on the same document and persists
# merged state server-side. Wire format mirrors @y-rb/actioncable
# ({ update: <base64> } JSON) so the yrb-actioncable client could be swapped in.
#
# Protocol:
#   server -> joining client : { type: "sync", update, sv, seed?, content_format?, seed_content?, seed_author_kind?, seed_author_name? }
#   client -> server         : { type: "sync-reply", update, cid, seq }   # everything server was missing
#                              { type: "update", update, cid, seq }       # incremental edit
#                              { type: "awareness", update, cid }    # presence/cursors, relay-only
#                              { type: "awareness-query", cid }      # ask peers to re-announce
# All client messages are broadcast to every subscriber (sender filters its own
# via cid); update/sync-reply are additionally merged into persistent storage.
class SyncChannel < ApplicationCable::Channel
  MAX_SEQUENCE_GAP = 256

  def subscribed
    @document = Document.find_by(slug: params[:slug])
    return reject unless @document

    @sequence_lock = Mutex.new
    @next_sequence = 1
    @pending_updates = {}
    stream_for @document

    full_state, state_vector = YjsPersistence.state_b64(@document)
    message = { type: "sync", update: full_state, sv: state_vector }
    if claim_seed?
      message[:seed] = true
      message[:content_format] = @document.content_format
      message[:seed_content] = @document.seed_content
      # Keep the old key for deployed Markdown clients during rollout.
      message[:seed_markdown] = @document.seed_content if @document.content_format == "markdown"
      # Omitted (not null) for legacy docs without recorded authorship —
      # keeps the wire format minimal and presence-of-key meaningful.
      message[:seed_author_kind] = @document.seed_author_kind if @document.seed_author_kind
      message[:seed_author_name] = @document.seed_author_name if @document.seed_author_name
    end
    transmit(message)
  end

  def receive(data)
    return unless @document

    message = data.slice("type", "update", "cid")
    case data["type"]
    when "update", "sync-reply"
      # Validate before relaying: a malformed frame must neither reach peers
      # nor crash the channel action.
      update = data["update"].to_s
      return if update.blank?
      begin
        Base64.strict_decode64(update)
      rescue ArgumentError
        Rails.logger.warn("SyncChannel: dropped malformed update frame")
        return
      end

      if data.key?("seq")
        sequence = Integer(data["seq"], exception: false)
        return unless sequence&.positive?

        enqueue_update(sequence, message, update)
      else
        # Rollout compatibility for clients deployed before ordered frames.
        persist_and_broadcast(message, update)
      end
    when "awareness", "awareness-query"
      self.class.broadcast_to(@document, message)
    end
  end

  private

  # Action Cable dispatches channel actions on a worker pool, so a burst of
  # causally dependent Yjs updates can enter #receive out of order. Applying
  # one of those updates in isolation leaves pending structs that y-rb's
  # full_diff does not serialize. Sequence and drain each subscription's
  # frames in client order before persisting them.
  def enqueue_update(sequence, message, update)
    @sequence_lock.synchronize do
      return if sequence < @next_sequence
      if sequence > @next_sequence + MAX_SEQUENCE_GAP
        Rails.logger.warn("SyncChannel: dropped update with excessive sequence gap")
        return
      end

      @pending_updates[sequence] ||= [ message, update ]
      while (frame = @pending_updates.delete(@next_sequence))
        persist_and_broadcast(*frame)
        @next_sequence += 1
      end
    end
  end

  def persist_and_broadcast(message, update)
    YjsPersistence.merge(@document, update)
    # A peer seeing an edit means the server has made it durable. This
    # ordering also prevents clients from accepting a frame that failed
    # persistence and would disappear on reload.
    self.class.broadcast_to(@document, message)
  rescue StandardError => e
    Rails.logger.warn("SyncChannel: merge failed: #{e.class}: #{e.message}")
  end

  # Exactly one client seeds an empty document from its markdown template.
  # The atomic claim lives on Document (shared with the HTTP grant path in
  # documents#show); this channel path remains as the stale-claim fallback.
  def claim_seed?
    @document.try_claim_seed
  end
end
