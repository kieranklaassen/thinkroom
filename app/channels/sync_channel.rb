# Relays Yjs CRDT messages between clients on the same document and persists
# merged state server-side. Wire format mirrors @y-rb/actioncable
# ({ update: <base64> } JSON) so the yrb-actioncable client could be swapped in.
#
# Protocol:
#   server -> joining client : { type: "sync", update, sv, seed?, seed_markdown? }
#   client -> server         : { type: "sync-reply", update, cid }   # everything server was missing
#                              { type: "update", update, cid }       # incremental edit
#                              { type: "awareness", update, cid }    # presence/cursors, relay-only
#                              { type: "awareness-query", cid }      # ask peers to re-announce
# All client messages are broadcast to every subscriber (sender filters its own
# via cid); update/sync-reply are additionally merged into persistent storage.
class SyncChannel < ApplicationCable::Channel
  SEED_CLAIM_TIMEOUT = 30.seconds

  def subscribed
    @document = Document.find_by(slug: params[:slug])
    return reject unless @document

    stream_for @document

    full_state, state_vector = YjsPersistence.state_b64(@document)
    message = { type: "sync", update: full_state, sv: state_vector }
    if claim_seed?
      message[:seed] = true
      message[:seed_markdown] = @document.seed_markdown
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

      self.class.broadcast_to(@document, message)
      begin
        YjsPersistence.merge(@document, update)
      rescue StandardError => e
        Rails.logger.warn("SyncChannel: merge failed: #{e.class}: #{e.message}")
      end
    when "awareness", "awareness-query"
      self.class.broadcast_to(@document, message)
    end
  end

  private

  # Exactly one client seeds an empty document from its markdown template.
  # The atomic UPDATE claims it; a stale claim (seeder crashed before its first
  # update persisted) is reclaimable after SEED_CLAIM_TIMEOUT.
  def claim_seed?
    return false if @document.yjs_state.present? || @document.seed_markdown.blank?

    Document
      .where(id: @document.id)
      .where(
        "seed_state = 'pending' OR (seed_state = 'claimed' AND seed_claimed_at < ?)",
        SEED_CLAIM_TIMEOUT.ago
      )
      .update_all(seed_state: "claimed", seed_claimed_at: Time.current) == 1
  end
end
