# Relays Yjs CRDT messages between clients on the same document and persists
# merged state server-side. Wire format mirrors @y-rb/actioncable
# ({ update: <base64> } JSON) so the yrb-actioncable client could be swapped in.
#
# Protocol:
#   server -> joining client : { type: "sync", update, sv, generation, seed?, content_format?, seed_content?, seed_author_kind?, seed_author_name? }
#   client -> server         : { type: "sync-reply", update, cid, seq, generation }   # everything server was missing
#                              { type: "update", update, cid, seq, generation }       # incremental edit
#                              { type: "awareness", update, cid }    # presence/cursors, relay-only
#                              { type: "awareness-query", cid }      # ask peers to re-announce
#                              { type: "seed-decline", cid }         # hand back a seed claim this handshake granted
# All client messages are broadcast to every subscriber (sender filters its own
# via cid); update/sync-reply are additionally merged into persistent storage.
#
# `generation` (Document#content_generation) is the client's last-known
# content generation, learned from the initial "sync" message and echoed back
# on every outgoing update/sync-reply frame. A client connected before an
# owner CLI replacement (Document#replace_content!) still has a live
# subscription — ActionCable has no way to know the content changed — but its
# next outgoing frame carries the stale generation. YjsPersistence.merge
# rejects (does not persist) a frame whose generation is behind the
# document's current one, so a stale tab can never resurrect content a
# replacement just wiped. A frame with no generation key (clients deployed
# before this) is trusted, matching the existing seq-less rollout-compatibility
# branch below.
class SyncChannel < ApplicationCable::Channel
  MAX_SEQUENCE_GAP = 256

  # In-process subscriber refcount per document id, driving the
  # fold-on-last-disconnect compaction trigger. Entries are removed when
  # the count reaches zero, so the map only holds actively-open documents.
  ACTIVE_SUBSCRIBERS = Concurrent::Map.new

  def self.track_subscribe(document_id)
    ACTIVE_SUBSCRIBERS.compute(document_id) { |count| count.to_i + 1 }
  end

  # => remaining subscriber count (0 removes the entry).
  def self.track_unsubscribe(document_id)
    ACTIVE_SUBSCRIBERS.compute(document_id) { |count| count.to_i > 1 ? count - 1 : nil }.to_i
  end

  def subscribed
    @document = Document.find_by(slug: params[:slug])
    return reject unless @document

    @sequence_lock = Mutex.new
    @next_sequence = 1
    @pending_updates = {}
    stream_for @document
    self.class.track_subscribe(@document.id)

    full_state, state_vector = YjsPersistence.state_b64(@document)
    message = { type: "sync", update: full_state, sv: state_vector, generation: @document.content_generation }
    if claim_seed?
      # Remember the grant so a "seed-decline" from this subscriber can
      # release exactly this claim (and only at this generation).
      @granted_seed_generation = @document.content_generation
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

  def unsubscribed
    return unless @document
    return unless self.class.track_unsubscribe(@document.id).zero?

    # Last subscriber gone: fold the update tail into the snapshot so cold
    # reads (instant-paint props, the next join) serve current state.
    YjsPersistence.fold!(@document)
  rescue StandardError => e
    Rails.logger.warn("SyncChannel: fold on disconnect failed: #{e.class}: #{e.message}")
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
        ActiveSupport::Notifications.instrument(
          "frame_dropped.yjs", document_id: @document.id, outcome: "dropped_malformed"
        )
        return
      end

      # nil (key absent) means "trust it" — rollout compatibility for clients
      # deployed before this field existed, mirroring the seq-less branch
      # below. Present-but-blank/non-integer is treated the same as absent
      # rather than as generation 0, so a malformed value can't accidentally
      # reject a legitimate current-generation frame.
      generation = Integer(data["generation"], exception: false) if data.key?("generation")

      if data.key?("seq")
        sequence = Integer(data["seq"], exception: false)
        return unless sequence&.positive?

        enqueue_update(sequence, message, update, generation)
      else
        # Rollout compatibility for clients deployed before ordered frames.
        persist_and_broadcast(message, update, generation)
      end
    when "awareness", "awareness-query"
      self.class.broadcast_to(@document, message)
    when "seed-decline"
      decline_seed_claim
    end
  end

  private

  # Action Cable dispatches channel actions on a worker pool, so a burst of
  # causally dependent Yjs updates can enter #receive out of order. Applying
  # one of those updates in isolation leaves pending structs that y-rb's
  # full_diff does not serialize. Sequence and drain each subscription's
  # frames in client order before persisting them.
  def enqueue_update(sequence, message, update, generation)
    @sequence_lock.synchronize do
      return if sequence < @next_sequence
      if sequence > @next_sequence + MAX_SEQUENCE_GAP
        ActiveSupport::Notifications.instrument(
          "frame_dropped.yjs",
          document_id: @document.id, outcome: "dropped_gap",
          sequence: sequence, expected_sequence: @next_sequence
        )
        return
      end

      @pending_updates[sequence] ||= [ message, update, generation ]
      while (frame = @pending_updates.delete(@next_sequence))
        persist_and_broadcast(*frame)
        @next_sequence += 1
      end
    end
  end

  def persist_and_broadcast(message, update, generation = nil)
    YjsPersistence.merge(
      @document,
      update,
      generation:,
      token: (connection.owner_token if connection.respond_to?(:owner_token)),
      user: (connection.current_user if connection.respond_to?(:current_user))
    )
    # A peer seeing an edit means the server has made it durable. This
    # ordering also prevents clients from accepting a frame that failed
    # persistence and would disappear on reload.
    self.class.broadcast_to(@document, message)
  rescue Document::EditingLockedError
    transmit({ type: "write-denied", locked: true })
  rescue Document::StaleGenerationError
    # The document was replaced (Document#replace_content!) since this client
    # last synced. Drop the frame — merging it would resurrect content the
    # replacement just wiped — and tell the client to discard its session
    # rather than silently dropping it with no recovery signal.
    transmit({ type: "write-denied", locked: false, stale: true })
  rescue StandardError => e
    Rails.logger.warn("SyncChannel: merge failed: #{e.class}: #{e.message}")
  end

  # Exactly one client seeds an empty document from its markdown template.
  # The atomic claim lives on Document (shared with the HTTP grant path in
  # documents#show); this channel path remains as the stale-claim fallback.
  def claim_seed?
    @document.try_claim_seed
  end

  # A subscriber granted the seed claim in its handshake hands it back when
  # it cannot apply the template — a reconnecting tab whose local doc
  # predates an owner replacement discards its session (page reload) instead
  # of seeding. Releasing the claim lets that reload's page render re-claim
  # immediately instead of leaving the document blank for everyone until
  # SEED_CLAIM_TIMEOUT expires. The conditional UPDATE only releases a
  # still-unconsumed claim at the granted generation: a merge that already
  # flipped seed_state to "seeded", or a replacement that advanced the
  # generation, leaves the row untouched.
  def decline_seed_claim
    generation = @granted_seed_generation
    return unless generation

    @granted_seed_generation = nil
    Document
      .where(id: @document.id, seed_state: "claimed", content_generation: generation)
      .update_all(seed_state: "pending", seed_claimed_at: nil)
  end
end
