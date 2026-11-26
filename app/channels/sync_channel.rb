# Relays Yjs CRDT messages between clients on the same document and persists
# merged state server-side via YjsPersistence. Uses a `{ update: <base64> }`
# JSON wire envelope paired with `CableProvider` on the frontend.
#
# Protocol:
#   client -> server (sub)   : { slug, cid?, client_id?, checksum?, sv?, generation? }
#   server -> joining client : { type: "sync", update, sv, checksum?, generation, seed?, seed_claim?, seed_pending?, content_format?, seed_content?, seed_author_kind?, seed_author_name? }
#                              # seed_claim: identifies the claim `seed` granted; returned on the claimant's frames until its
#                              # seed is stored, and refused (write-denied stale) once another claimant's seed is.
#                              # seed_pending: nothing is stored yet and another subscriber holds the seed claim, so the
#                              # empty state is not the document. Viewers who cannot write also get the seed_* fields to show.
#                              { type: "awareness", update, cid }     # cached active peers, unicast on join
#                              { type: "write-denied", reason: "stale", stale: true, locked: false, generation }
#   server -> sender         : { type: "ack", seq }                            # durable merge receipt (when seq was sent)
#                              { type: "nack", seq, reason: "retryable" | "invalid" }
#                              { type: "write-denied", locked: true }          # read-only link
#                              { type: "write-denied", locked: false, stale: true } # document was replaced
#   client -> server         : { type: "sync-reply", update, cid, seq?, generation, seed_claim? } # unacked edits flushed on reconnect
#                              { type: "update", update, cid, seq?, generation, seed_claim? } # incremental edit
#                              { type: "awareness", update, cid, client_id? }        # presence/cursors, cached + relayed (4 KiB cap)
#                              { type: "seed-decline", cid }                         # hand back a seed claim this handshake granted
#                              { type: "seed-request", cid }                         # waiting writer retries the claim; answered with a "sync"
#   server -> peers          : { type: "awareness-leave", cid, client_id }           # emitted on subscriber disconnect
# All client messages are broadcast to every subscriber (sender filters its own
# via cid); update/sync-reply are persisted before broadcast and acknowledged
# back to the sender. Ordering is enforced client-side by CableProvider's
# single-in-flight coalescing outbox, so each subscription has at most one frame
# in flight at a time and needs no server-side reordering buffer.
#
# `generation` (Document#content_generation) is the client's last-known
# content generation, initialized from documents#show props and verified on the
# initial "sync" message, then echoed back on every outgoing update/sync-reply
# frame and reconnect subscribe params. A client connected before an owner CLI
# replacement (Document#replace_content!) still has a live subscription —
# ActionCable has no way to know the content changed — but its next outgoing
# frame or reconnect subscribe carries the stale generation. SyncChannel#subscribed
# rejects stale reconnects immediately without loading yjs_state or claiming a
# seed, and YjsPersistence.merge_bytes rejects any frame whose generation is
# missing, malformed, or behind the document's current one, so a stale or
# misbehaving client can never resurrect content a replacement just wiped.
class SyncChannel < ApplicationCable::Channel
  MAX_AWARENESS_BYTES = YjsAwarenessCache::MAX_AWARENESS_BYTES
  # In-process subscriber refcount per document id, driving the
  # fold-on-last-disconnect compaction trigger and awareness cache eviction.
  # Entries are removed when the count reaches zero, so the map only holds
  # actively-open documents.
  ACTIVE_SUBSCRIBERS = Concurrent::Map.new

  def self.track_subscribe(document_id)
    ACTIVE_SUBSCRIBERS.compute(document_id) { |count| count.to_i + 1 }
  end

  # => remaining subscriber count (0 removes the entry).
  def self.track_unsubscribe(document_id)
    ACTIVE_SUBSCRIBERS.compute(document_id) { |count| count.to_i > 1 ? count - 1 : nil }.to_i
  end

  def subscribed
    document = Document.find_by(slug: params[:slug])
    return reject unless document

    client_generation = YjsPersistence.parse_generation(params[:generation]) unless params[:generation].nil?
    if client_generation && client_generation < document.content_generation
      transmit({
        type: "write-denied",
        reason: "stale",
        stale: true,
        locked: false,
        generation: document.content_generation
      })
      return
    end

    @document = document
    @subscriber_key = SecureRandom.uuid
    @subscriber_cid = params[:cid].presence&.to_s
    @awareness_client_id = Integer(params[:client_id], exception: false) unless params[:client_id].nil?
    stream_for @document
    self.class.track_subscribe(@document.id)

    transmit_handshake

    transmit_cached_awareness
  rescue ActiveRecord::RecordNotFound
    reject # deleted during the handshake
  end

  def unsubscribed
    return unless @document

    if self.class.track_unsubscribe(@document.id).zero?
      YjsAwarenessCache.clear_document(@document.id)
      # Last subscriber gone: fold the update tail into the snapshot so cold
      # reads (instant-paint props, the next join) serve current state.
      YjsPersistence.fold!(@document)
    else
      evict_awareness
    end
  rescue StandardError => e
    Rails.logger.warn("SyncChannel: unsubscribe cleanup failed: #{e.class}: #{e.message}")
  end

  def receive(data)
    return unless @document

    message = data.slice("type", "update", "cid")
    case data["type"]
    when "update", "sync-reply"
      # Validate before relaying or buffering: oversized or malformed frames
      # must neither allocate unbounded decode buffers, reach peers, nor crash
      # the channel action.
      update = data["update"].to_s
      return if update.blank?

      if update.bytesize > YjsPersistence::MAX_UPDATE_B64_BYTES
        ActiveSupport::Notifications.instrument(
          "frame_dropped.yjs", document_id: @document.id, outcome: "dropped_oversized"
        )
        return
      end

      decoded = begin
        Base64.strict_decode64(update)
      rescue ArgumentError
        ActiveSupport::Notifications.instrument(
          "frame_dropped.yjs", document_id: @document.id, outcome: "dropped_malformed"
        )
        return
      end

      if decoded.bytesize > YjsPersistence::MAX_UPDATE_BYTES
        ActiveSupport::Notifications.instrument(
          "frame_dropped.yjs", document_id: @document.id, outcome: "dropped_oversized"
        )
        return
      end
      generation = YjsPersistence.parse_generation(data["generation"])

      seq = nil
      if data.key?("seq")
        seq = Integer(data["seq"], exception: false)
        return unless seq&.positive?
      end

      persist_and_broadcast(message, decoded, generation:, seed_claim: data["seed_claim"], seq:)
    when "awareness"
      handle_awareness(data)
    when "seed-decline"
      decline_seed_claim
    when "seed-request"
      retry_seed_claim
    end
  end

  private

  def transmit_handshake
    granted = claim_seed?
    claimed_at = @document.seed_claimed_at if granted
    seed_claim = @document.seed_claim_token if granted
    # Decided before the state is read: content landing in between then travels
    # with the flag, where the other order would send an unmarked empty state.
    pending = !granted && seed_pending?
    message = build_sync_message
    if granted
      # Remember the grant so a "seed-decline" from this subscriber can
      # release exactly this claim (and only at this generation).
      @granted_seed_generation = @document.content_generation
      @granted_seed_claimed_at = claimed_at
      message[:seed] = true
      message[:seed_claim] = seed_claim
      add_seed(message)
    elsif pending
      message[:seed_pending] = true
      add_seed(message) unless writable?
    end
    transmit(message)
  end

  def add_seed(message)
    message[:content_format] = @document.content_format
    message[:seed_content] = @document.seed_content
    # Omitted (not null) for legacy docs without recorded authorship —
    # keeps the wire format minimal and presence-of-key meaningful.
    message[:seed_author_kind] = @document.seed_author_kind if @document.seed_author_kind
    message[:seed_author_name] = @document.seed_author_name if @document.seed_author_name
  end

  # A seeded document can be emptied again by recovery (YjsRecovery). No claim
  # can be won there, so waiting for one would never end.
  def seed_pending?
    @document.seed_state != "seeded" && @document.seed_content.present? && !@document.live_crdt?
  end

  def writable?
    @document.writable_by?(connection_owner_token, user: connection_current_user)
  end

  # Sent by a writer whose handshake was seed_pending. The claimant may have
  # persisted, replaced, or abandoned the seed since, so answer from current
  # rows with a whole new handshake.
  def retry_seed_claim
    @document.reload
    transmit_handshake if writable?
  rescue ActiveRecord::RecordNotFound
    # Deleted since; DocumentMetaChannel tells the client.
  end

  def build_sync_message
    client_checksum = params[:checksum].presence&.to_s
    if checksum_matches?(client_checksum)
      ActiveSupport::Notifications.instrument(
        "state.yjs",
        document_id: @document.id,
        served_from: "checksum",
        blob_bytes: 0,
        outcome: "ok"
      )
      return {
        type: "sync",
        update: "",
        sv: Base64.strict_encode64(@document.yjs_state_vector),
        checksum: @document.yjs_state_checksum,
        generation: @document.content_generation
      }
    end

    update_b64, state_vector_b64 = if params[:sv].present?
      YjsPersistence.diff_b64(@document, params[:sv].to_s)
    else
      YjsPersistence.state_b64(@document)
    end

    message = {
      type: "sync",
      update: update_b64,
      sv: state_vector_b64,
      generation: @document.content_generation
    }
    message[:checksum] = @document.yjs_state_checksum if @document.yjs_state_checksum.present?
    message
  end

  # Match on yjs_state_checksum (SHA-256 of the full compacted blob including
  # its DeleteSet) plus an empty update tail — never yjs_state_vector alone,
  # because Yjs state vectors omit DeleteSets.
  def checksum_matches?(client_checksum)
    return false if client_checksum.blank? || @document.yjs_document_updates.exists?

    # Reload after the tail check: another join may have folded the tail into
    # the columns since this row was loaded.
    @document.reload
    @document.yjs_state_checksum.present? &&
      @document.yjs_state_vector.present? &&
      client_checksum == @document.yjs_state_checksum
  end

  def handle_awareness(data)
    update = data["update"].to_s
    return if update.blank?

    if update.bytesize > YjsAwarenessCache::MAX_AWARENESS_B64_BYTES
      ActiveSupport::Notifications.instrument(
        "frame_dropped.yjs",
        document_id: @document.id,
        outcome: "dropped_oversized_awareness",
        update_bytes: update.bytesize
      )
      return
    end

    decoded = begin
      Base64.strict_decode64(update)
    rescue ArgumentError
      ActiveSupport::Notifications.instrument(
        "frame_dropped.yjs", document_id: @document.id, outcome: "dropped_malformed"
      )
      return
    end

    if decoded.bytesize > MAX_AWARENESS_BYTES
      ActiveSupport::Notifications.instrument(
        "frame_dropped.yjs",
        document_id: @document.id,
        outcome: "dropped_oversized_awareness",
        update_bytes: decoded.bytesize
      )
      return
    end

    cid = data["cid"].presence&.to_s || @subscriber_cid
    @subscriber_cid ||= cid
    client_id =
      (Integer(data["client_id"], exception: false) unless data["client_id"].nil?) ||
      @awareness_client_id ||
      YjsAwarenessCache.extract_client_id(decoded)
    @awareness_client_id ||= client_id

    YjsAwarenessCache.put(@document.id, @subscriber_key, update:, cid:, client_id:)
    self.class.broadcast_to(@document, data.slice("type", "update", "cid"))
  end

  def transmit_cached_awareness
    YjsAwarenessCache.peers_for(
      @document.id,
      exclude_key: @subscriber_key,
      exclude_cid: @subscriber_cid
    ).each do |entry|
      transmit({ type: "awareness", update: entry.update, cid: entry.cid })
    end
  end

  def evict_awareness
    removed = YjsAwarenessCache.remove(@document.id, @subscriber_key)
    client_id = removed&.client_id || @awareness_client_id
    return unless removed && client_id
    return if YjsAwarenessCache.active_client_id?(@document.id, client_id)

    self.class.broadcast_to(@document, {
      type: "awareness-leave",
      cid: removed.cid || @subscriber_cid,
      client_id:
    })
  end

  def persist_and_broadcast(message, decoded, generation:, seed_claim: nil, seq: nil)
    YjsPersistence.merge_bytes(
      @document,
      decoded,
      generation:,
      seed_claim:,
      token: connection_owner_token,
      user: connection_current_user
    )
    # A peer seeing an edit means the server has made it durable. This
    # ordering also prevents clients from accepting a frame that failed
    # persistence and would disappear on reload.
    self.class.broadcast_to(@document, message)
    transmit({ type: "ack", seq: }) if seq
  rescue Document::EditingLockedError
    transmit({ type: "write-denied", locked: true })
  rescue Document::StaleGenerationError
    # The document was replaced (Document#replace_content!) since this client
    # last synced, or the frame omitted a valid generation. Drop the frame —
    # merging it would resurrect content the replacement just wiped — and tell
    # the client to discard its session rather than silently dropping it with
    # no recovery signal.
    transmit({ type: "write-denied", locked: false, stale: true })
  rescue ArgumentError => e
    Rails.logger.warn("SyncChannel: undecodable update dropped: #{e.message}")
    transmit({ type: "nack", seq:, reason: "invalid" }) if seq
  rescue StandardError => e
    Rails.logger.warn("SyncChannel: merge failed: #{e.class}: #{e.message}")
    transmit({ type: "nack", seq:, reason: "retryable" }) if seq
  end

  def connection_owner_token
    connection.owner_token if connection.respond_to?(:owner_token)
  end

  def connection_current_user
    connection.current_user if connection.respond_to?(:current_user)
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
  # generation, or another client's newer claim, leaves the row untouched.
  def decline_seed_claim
    generation = @granted_seed_generation
    return unless generation

    @granted_seed_generation = nil
    Document
      .where(id: @document.id, seed_state: "claimed", content_generation: generation,
             seed_claimed_at: @granted_seed_claimed_at)
      .update_all(seed_state: "pending", seed_claimed_at: nil)
  end
end
