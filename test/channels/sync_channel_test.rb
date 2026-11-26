require "test_helper"

class SyncChannelTest < ActionCable::Channel::TestCase
  def build_update_b64(text)
    ydoc = Y::Doc.new
    ydoc.get_text("t") << text
    Base64.strict_encode64(ydoc.encode_state_as_update)
  end

  def build_sequential_updates
    ydoc = Y::Doc.new
    text = ydoc.get_text("t")
    before_first = ydoc.encode_state_vector
    text << "a"
    first = ydoc.encode_state_as_update(before_first)
    before_second = ydoc.encode_state_vector
    text << "b"
    second = ydoc.encode_state_as_update(before_second)
    [ first, second ].map { |update| Base64.strict_encode64(update) }
  end

  test "subscribing transmits the sync handshake" do
    doc = Document.create!(title: "Live")

    subscribe slug: doc.slug

    assert subscription.confirmed?
    message = transmissions.last
    assert_equal "sync", message["type"]
    assert message.key?("update")
    assert message["sv"].present?
  end

  test "subscribing to an unknown slug is rejected" do
    subscribe slug: "nope"
    assert subscription.rejected?
  end

  test "first subscriber to an unseeded doc gets the seed flag, second does not" do
    doc = Document.create!(title: "Seedme", seed_markdown: "# Template")

    subscribe slug: doc.slug
    assert_equal true, transmissions.last["seed"]
    assert_equal "markdown", transmissions.last["content_format"]
    assert_equal "# Template", transmissions.last["seed_content"]
    assert_not transmissions.last.key?("seed_markdown")

    unsubscribe
    subscribe slug: doc.slug
    assert_nil transmissions.last["seed"]
  end

  test "HTML seed grant carries generic source without the legacy markdown key" do
    doc = Document.create!(
      title: "HTML",
      content_format: "html",
      seed_content: "<h1>Template</h1>"
    )

    subscribe slug: doc.slug

    message = transmissions.last
    assert_equal true, message["seed"]
    assert_equal "html", message["content_format"]
    assert_equal "<h1>Template</h1>", message["seed_content"]
    assert_not message.key?("seed_markdown")
  end

  test "seed grant carries agent authorship for agent-seeded docs" do
    doc = Document.create!(
      title: "AgentSeed", seed_markdown: "# From an agent",
      seed_author_kind: "agent", seed_author_name: "Scout"
    )

    subscribe slug: doc.slug

    message = transmissions.last
    assert_equal true, message["seed"]
    assert_equal "agent", message["seed_author_kind"]
    assert_equal "Scout", message["seed_author_name"]
  end

  test "stale-claim reclaim still carries agent authorship" do
    doc = Document.create!(
      title: "Reclaimed", seed_markdown: "# From an agent",
      seed_author_kind: "agent", seed_author_name: "Scout"
    )
    assert doc.try_claim_seed, "HTTP path wins the fresh claim"

    travel Document::SEED_CLAIM_TIMEOUT + 1.second do
      subscribe slug: doc.slug

      message = transmissions.last
      assert_equal true, message["seed"]
      assert_equal "agent", message["seed_author_kind"]
      assert_equal "Scout", message["seed_author_name"]
    end
  end

  test "no-grant sync carries no seed authorship fields" do
    doc = Document.create!(title: "Hydrated", seed_markdown: "# Template",
                           seed_author_kind: "agent", seed_author_name: "Scout")
    YjsPersistence.merge(doc, build_update_b64("already here"))

    subscribe slug: doc.slug

    message = transmissions.last
    assert_nil message["seed"]
    assert_not message.key?("seed_author_kind")
    assert_not message.key?("seed_author_name")
  end

  test "an HTTP page-render claim blocks the channel grant while fresh" do
    doc = Document.create!(title: "PreClaimed", seed_markdown: "# Template")
    assert doc.try_claim_seed, "HTTP path should win the fresh claim"

    subscribe slug: doc.slug

    assert subscription.confirmed?
    assert_nil transmissions.last["seed"],
               "channel must not re-grant a seed freshly claimed by documents#show"
  end

  test "an empty handshake held back by another claim is marked seed_pending without the template" do
    doc = Document.create!(title: "HeldElsewhere", seed_markdown: "# Template")
    assert doc.try_claim_seed

    subscribe slug: doc.slug

    message = transmissions.last
    assert_equal true, message["seed_pending"]
    assert_nil message["seed"]
    assert_not message.key?("seed_content"), "a second writer must not be able to apply the template"
  end

  test "a reader without a grant receives the seed to show and claims nothing" do
    doc = Document.create!(
      title: "ReaderSeed", seed_markdown: "# Template",
      seed_author_kind: "agent", seed_author_name: "Scout",
      owner_token: "owner", owner_name: "Owner", link_access: "view"
    )
    assert doc.try_claim_seed
    claimed_at = doc.reload.seed_claimed_at

    subscribe slug: doc.slug

    message = transmissions.last
    assert_equal true, message["seed_pending"]
    assert_nil message["seed"]
    assert_equal "# Template", message["seed_content"]
    assert_equal "agent", message["seed_author_kind"]
    assert_equal claimed_at, doc.reload.seed_claimed_at
  end

  test "a granted, seedless or live handshake is never seed_pending" do
    granted = Document.create!(title: "Granted", seed_markdown: "# Template")
    subscribe slug: granted.slug
    assert_not transmissions.last.key?("seed_pending")

    seedless = Document.create!(title: "Seedless", seed_markdown: nil)
    subscribe slug: seedless.slug
    assert_not transmissions.last.key?("seed_pending")

    live = Document.create!(title: "Live", seed_markdown: "# Template")
    YjsPersistence.merge(live, build_update_b64("content"))
    subscribe slug: live.slug
    assert_not transmissions.last.key?("seed_pending")
  end

  test "content persisted while the empty handshake is built is not served as a plain empty sync" do
    doc = Document.create!(title: "PersistedDuringJoin", seed_markdown: "# Template")
    assert doc.try_claim_seed
    content = build_update_b64("content")

    original = YjsPersistence.method(:state_b64)
    YjsPersistence.define_singleton_method(:state_b64) do |document|
      original.call(document).tap { YjsPersistence.merge(Document.find(document.id), content) }
    end
    begin
      subscribe slug: doc.slug
    ensure
      YjsPersistence.define_singleton_method(:state_b64, original)
    end

    assert_equal true, transmissions.last["seed_pending"]
  end

  test "a document deleted while its handshake is built rejects the subscription" do
    doc = Document.create!(title: "DeletedDuringJoin", seed_markdown: "# Template")

    original = SyncChannel.method(:track_subscribe)
    SyncChannel.define_singleton_method(:track_subscribe) do |id|
      original.call(id).tap { Document.find(id).destroy! }
    end
    begin
      subscribe slug: doc.slug
    ensure
      SyncChannel.define_singleton_method(:track_subscribe, original)
    end

    assert subscription.rejected?
  end

  test "seed-request for a deleted document is ignored" do
    doc = Document.create!(title: "DeletedWhileWaiting", seed_markdown: "# Template")
    assert doc.try_claim_seed
    subscribe slug: doc.slug
    Document.find(doc.id).destroy!

    assert_nothing_raised { perform :receive, { "type" => "seed-request", "cid" => "waiting" } }
  end

  test "a granted handshake carries the claim, and a slow claimant's seed is refused as stale" do
    doc = Document.create!(title: "SlowChannelClaimant", seed_markdown: "# Template")
    subscribe slug: doc.slug
    claim = transmissions.last["seed_claim"]
    assert_equal doc.reload.seed_claim_token, claim
    assert claim.present?

    travel Document::SEED_CLAIM_TIMEOUT + 1.second do
      other = Document.find(doc.id)
      assert other.try_claim_seed
      YjsPersistence.merge(other, build_update_b64("body"), seed_claim: other.seed_claim_token)
    end
    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      perform :receive, {
        "type" => "update", "update" => build_update_b64("body"), "cid" => "slow", "seq" => 1,
        "generation" => doc.content_generation, "seed_claim" => claim
      }
    end

    assert_equal "write-denied", transmissions.last["type"]
    assert_equal true, transmissions.last["stale"]
    assert_equal 1, doc.reload.yjs_document_updates.count
  end

  test "an ungranted handshake carries no claim" do
    doc = Document.create!(title: "NoClaim", seed_markdown: "# Template")
    assert doc.try_claim_seed
    subscribe slug: doc.slug
    assert_not transmissions.last.key?("seed_claim")
  end

  test "seed-request retries an abandoned claim and answers with a fresh handshake" do
    doc = Document.create!(title: "Abandoned", seed_markdown: "# Template")
    assert doc.try_claim_seed
    subscribe slug: doc.slug

    perform :receive, { "type" => "seed-request", "cid" => "waiting" }
    assert_equal true, transmissions.last["seed_pending"], "the claim is still held"

    travel Document::SEED_CLAIM_TIMEOUT + 1.second do
      perform :receive, { "type" => "seed-request", "cid" => "waiting" }
      assert_equal true, transmissions.last["seed"]
      assert_equal "# Template", transmissions.last["seed_content"]
    end
  end

  test "seed-request delivers content the claimant has since persisted" do
    doc = Document.create!(title: "Arrived", seed_markdown: "# Template")
    assert doc.try_claim_seed
    subscribe slug: doc.slug
    YjsPersistence.merge(Document.find(doc.id), build_update_b64("content"))

    perform :receive, { "type" => "seed-request", "cid" => "waiting" }

    message = transmissions.last
    assert_not message.key?("seed_pending")
    client = Y::Doc.new
    client.apply_update(Base64.strict_decode64(message["update"]))
    assert_equal "content", client.get_text("t").to_s
  end

  test "seed-request from a reader never takes the claim" do
    doc = Document.create!(
      title: "ReaderRequest", seed_markdown: "# Template",
      owner_token: "owner", owner_name: "Owner", link_access: "view"
    )
    assert doc.try_claim_seed
    subscribe slug: doc.slug

    travel Document::SEED_CLAIM_TIMEOUT + 1.second do
      claimed_at = doc.reload.seed_claimed_at
      assert_no_difference -> { transmissions.length } do
        perform :receive, { "type" => "seed-request", "cid" => "reader" }
      end
      assert_equal claimed_at, doc.reload.seed_claimed_at
    end
  end

  test "a checksum the joining row no longer stores is not answered as up to date" do
    doc = Document.create!(title: "FoldedDuringJoin")
    YjsPersistence.merge(doc, build_update_b64("first"))
    YjsPersistence.fold!(doc)
    old_checksum = doc.reload.yjs_state_checksum
    late = build_update_b64("second")

    original = SyncChannel.method(:track_subscribe)
    SyncChannel.define_singleton_method(:track_subscribe) do |id|
      other = Document.find(id)
      YjsPersistence.merge(other, late)
      YjsPersistence.fold!(other)
      original.call(id)
    end
    begin
      subscribe slug: doc.slug, checksum: old_checksum
    ensure
      SyncChannel.define_singleton_method(:track_subscribe, original)
    end

    assert_not_equal "", transmissions.last["update"]
    assert_equal doc.reload.yjs_state_checksum, transmissions.last["checksum"]
  end

  test "documents with existing state never seed" do
    doc = Document.create!(title: "Existing", seed_markdown: "# Template")
    YjsPersistence.merge(doc, build_update_b64("already here"))

    subscribe slug: doc.slug
    assert_nil transmissions.last["seed"]
  end

  test "update messages are broadcast to the document stream and persisted" do
    doc = Document.create!(title: "Relay")
    subscribe slug: doc.slug

    update = build_update_b64("typed text")
    assert_broadcast_on(SyncChannel.broadcasting_for(doc), type: "update", update: update, cid: "abc") do
      perform :receive, {
        "type" => "update", "update" => update, "cid" => "abc", "generation" => doc.content_generation
      }
    end

    assert doc.reload.yjs_document_updates.exists?, "the frame must be durably appended"
  end

  test "subscribing transmits the document's current content generation" do
    doc = Document.create!(title: "Generation")
    subscribe slug: doc.slug

    assert_equal 0, transmissions.last["generation"]
  end

  test "a frame carrying a stale generation is rejected, not merged" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    YjsPersistence.merge(doc, build_update_b64("live editor content"))
    subscribe slug: doc.slug
    stale_generation = transmissions.last["generation"]

    doc.replace_content!(source: "# Replacement")
    assert_equal stale_generation + 1, doc.reload.content_generation

    update = build_update_b64("resurrected stale content")
    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      perform :receive, {
        "type" => "update", "update" => update, "cid" => "stale-tab", "generation" => stale_generation
      }
    end

    assert_nil doc.reload.yjs_state, "a stale-generation frame must never resurrect yjs_state"
    last = transmissions.last
    assert_equal "write-denied", last["type"]
    assert_equal true, last["stale"]

    # The literal #120 repro: a fresh, independent read (what an incognito
    # hard refresh's documents#show ultimately reads from) must see the
    # replacement, not content the stale tab tried to resurrect.
    assert_equal "# Replacement", Document.find(doc.id).current_content
  end

  test "a frame carrying the current generation persists normally" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    subscribe slug: doc.slug
    current_generation = transmissions.last["generation"]
    update = build_update_b64("current content")

    assert_broadcast_on(SyncChannel.broadcasting_for(doc), type: "update", update:, cid: "fresh-tab") do
      perform :receive, {
        "type" => "update", "update" => update, "cid" => "fresh-tab", "generation" => current_generation
      }
    end

    assert doc.reload.yjs_document_updates.exists?
  end

  test "a frame with missing, nil, or malformed generation is rejected as stale" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    subscribe slug: doc.slug
    doc.replace_content!(source: "# Replacement")
    update = build_update_b64("no generation sent")

    [
      { "type" => "update", "update" => update, "cid" => "legacy-client" },
      { "type" => "update", "update" => update, "cid" => "nil-gen", "generation" => nil },
      { "type" => "update", "update" => update, "cid" => "bad-gen", "generation" => "not-an-int" },
      { "type" => "update", "update" => update, "cid" => "seq-no-gen", "seq" => 2 }
    ].each do |frame|
      assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
        perform :receive, frame
      end
      last = transmissions.last
      assert_equal "write-denied", last["type"]
      assert_equal true, last["stale"]
    end

    assert_nil doc.reload.yjs_state
    assert_not doc.yjs_document_updates.exists?
  end

  test "locked non-owner updates are rejected without persistence or relay" do
    doc = Document.create!(
      title: "Locked",
      owner_token: "owner-token",
      owner_name: "Owner",
      link_access: "view"
    )
    subscribe slug: doc.slug
    update = build_update_b64("forbidden")

    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      perform :receive, {
        "type" => "update", "update" => update, "cid" => "reader", "generation" => doc.content_generation
      }
    end

    assert_not doc.reload.yjs_document_updates.exists?
    assert_equal "write-denied", transmissions.last["type"]
    assert_equal true, transmissions.last["locked"]
  end

  test "locked guest owner updates still persist and relay" do
    doc = Document.create!(
      title: "Locked",
      owner_token: "owner-token",
      owner_name: "Owner",
      link_access: "view"
    )
    stub_connection(owner_token: "owner-token", current_user: nil)
    subscribe slug: doc.slug
    update = build_update_b64("owner edit")

    assert_broadcast_on(
      SyncChannel.broadcasting_for(doc),
      type: "update", update:, cid: "owner"
    ) do
      perform :receive, {
        "type" => "update", "update" => update, "cid" => "owner", "generation" => doc.content_generation
      }
    end
    assert doc.reload.yjs_document_updates.exists?
  end

  test "locked readers still relay awareness" do
    doc = Document.create!(
      title: "Locked",
      owner_token: "owner-token",
      owner_name: "Owner",
      link_access: "view"
    )
    subscribe slug: doc.slug

    assert_broadcast_on(
      SyncChannel.broadcasting_for(doc),
      type: "awareness", update: "AAAA", cid: "reader"
    ) do
      perform :receive, { "type" => "awareness", "update" => "AAAA", "cid" => "reader" }
    end
  end

  test "malformed update frames are dropped without raising or relaying" do
    doc = Document.create!(title: "Poison")
    subscribe slug: doc.slug

    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      perform :receive, { "type" => "update", "update" => "not!!base64!!", "cid" => "x" }
    end
    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      perform :receive, { "type" => "update", "cid" => "x" }
    end
    assert_nil doc.reload.yjs_state
  end

  test "an update that fails persistence is not relayed to peers" do
    doc = Document.create!(title: "Failed relay")
    subscribe slug: doc.slug
    update = build_update_b64("not durable")

    original_merge = YjsPersistence.method(:merge_bytes)
    YjsPersistence.define_singleton_method(:merge_bytes) { |*| raise "storage unavailable" }
    begin
      assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
        perform :receive, {
          "type" => "update", "update" => update, "cid" => "x", "generation" => doc.content_generation
        }
      end
    ensure
      YjsPersistence.define_singleton_method(:merge_bytes, original_merge)
    end

    assert_nil doc.reload.yjs_state
    assert_equal "sync", transmissions.last["type"], "seq-less failure does not emit nack"
  end

  test "a sequenced update that fails transiently transmits a retryable nack without relaying" do
    doc = Document.create!(title: "Retryable failure")
    subscribe slug: doc.slug
    update = build_update_b64("transient error")

    original_merge = YjsPersistence.method(:merge_bytes)
    YjsPersistence.define_singleton_method(:merge_bytes) { |*| raise SQLite3::BusyException, "database is locked" }
    begin
      assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
        perform :receive, {
          "type" => "update", "update" => update, "cid" => "x", "seq" => 4,
          "generation" => doc.content_generation
        }
      end
    ensure
      YjsPersistence.define_singleton_method(:merge_bytes, original_merge)
    end

    assert_nil doc.reload.yjs_state
    assert_equal({ "type" => "nack", "seq" => 4, "reason" => "retryable" }, transmissions.last)
  end

  test "a sequenced undecodable update transmits an invalid nack without relaying" do
    doc = Document.create!(title: "Undecodable")
    subscribe slug: doc.slug
    undecodable = Base64.strict_encode64("\xff\xff\xff\xff".b)

    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      perform :receive, {
        "type" => "update", "update" => undecodable, "cid" => "x", "seq" => 2,
        "generation" => doc.content_generation
      }
    end

    assert_nil doc.reload.yjs_state
    assert_equal({ "type" => "nack", "seq" => 2, "reason" => "invalid" }, transmissions.last)
  end

  test "sequenced updates persist, broadcast, and transmit an ack receipt" do
    doc = Document.create!(title: "Acked relay")
    subscribe slug: doc.slug
    first, second = build_sequential_updates

    assert_broadcast_on(SyncChannel.broadcasting_for(doc), type: "update", update: first, cid: "x") do
      perform :receive, {
        "type" => "update", "update" => first, "cid" => "x", "seq" => 1,
        "generation" => doc.content_generation
      }
    end
    assert_equal({ "type" => "ack", "seq" => 1 }, transmissions.last)

    assert_broadcast_on(SyncChannel.broadcasting_for(doc), type: "sync-reply", update: second, cid: "x") do
      perform :receive, {
        "type" => "sync-reply", "update" => second, "cid" => "x", "seq" => 2,
        "generation" => doc.content_generation
      }
    end
    assert_equal({ "type" => "ack", "seq" => 2 }, transmissions.last)

    full_state, = YjsPersistence.state_b64(doc.reload)
    persisted = Y::Doc.new
    persisted.apply_update(Base64.strict_decode64(full_state))
    assert_equal "ab", persisted.get_text("t").to_s
  end

  test "a seq-less update persists and broadcasts without transmitting an ack" do
    doc = Document.create!(title: "Legacy client")
    subscribe slug: doc.slug
    update = build_update_b64("legacy")

    assert_broadcast_on(SyncChannel.broadcasting_for(doc), type: "update", update: update, cid: "legacy") do
      perform :receive, {
        "type" => "update", "update" => update, "cid" => "legacy",
        "generation" => doc.content_generation
      }
    end

    assert_equal "sync", transmissions.last["type"]
  end

  test "a non-positive or malformed seq is dropped without persisting or acking" do
    doc = Document.create!(title: "Bad seq")
    subscribe slug: doc.slug
    update = build_update_b64("ignored")

    [ 0, -1, "abc", nil ].each do |bad_seq|
      assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
        perform :receive, {
          "type" => "update", "update" => update, "cid" => "x", "seq" => bad_seq,
          "generation" => doc.content_generation
        }
      end
    end

    assert_not doc.reload.yjs_document_updates.exists?
    assert_equal "sync", transmissions.last["type"]
  end

  test "sequenced locked and stale frames transmit write-denied rather than ack or nack" do
    locked_doc = Document.create!(
      title: "Locked",
      owner_token: "owner-token",
      owner_name: "Owner",
      link_access: "view"
    )
    subscribe slug: locked_doc.slug
    perform :receive, {
      "type" => "update", "update" => build_update_b64("no"), "cid" => "r", "seq" => 1,
      "generation" => locked_doc.content_generation
    }
    assert_equal({ "type" => "write-denied", "locked" => true }, transmissions.last)

    unsubscribe

    stale_doc = Document.create!(title: "Stale", seed_content: "# Seed")
    subscribe slug: stale_doc.slug
    stale_generation = transmissions.last["generation"]
    stale_doc.replace_content!(source: "# Replaced")
    perform :receive, {
      "type" => "update", "update" => build_update_b64("old"), "cid" => "s",
      "seq" => 1, "generation" => stale_generation
    }
    assert_equal({ "type" => "write-denied", "locked" => false, "stale" => true }, transmissions.last)
  end

  test "first subscriber still gets the seed after an empty sync-reply was merged" do
    doc = Document.create!(title: "Race", seed_markdown: "# Template")
    subscribe slug: doc.slug

    # A joining client with an empty doc replies with a no-op update.
    empty_update = Base64.strict_encode64(Y::Doc.new.compacted_state_update)
    perform :receive, {
      "type" => "sync-reply", "update" => empty_update, "cid" => "x",
      "generation" => doc.content_generation
    }

    # The claim is consumed but reclaimable after timeout because the no-op
    # merge did not flip seed_state to "seeded".
    travel Document::SEED_CLAIM_TIMEOUT + 1.second do
      unsubscribe
      subscribe slug: doc.slug
      assert_equal true, transmissions.last["seed"], "doc must remain seedable after a no-op merge"
    end
  end

  test "a malformed frame emits a frame_dropped event" do
    doc = Document.create!(title: "Poison metered")
    subscribe slug: doc.slug

    assert_notification("frame_dropped.yjs", document_id: doc.id, outcome: "dropped_malformed") do
      perform :receive, {
        "type" => "update", "update" => "not!!base64!!", "cid" => "x",
        "generation" => doc.content_generation
      }
    end
  end

  test "oversized update frames are dropped before base64 decoding" do
    doc = Document.create!(title: "Oversized")
    subscribe slug: doc.slug

    # Invalid base64 beyond the pre-decode encoded cap must trigger
    # dropped_oversized (not dropped_malformed) without calling strict_decode64.
    huge = "!" * (YjsPersistence::MAX_UPDATE_B64_BYTES + 1)
    assert_notification("frame_dropped.yjs", document_id: doc.id, outcome: "dropped_oversized") do
      assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
        perform :receive, {
          "type" => "update", "update" => huge, "cid" => "x",
          "generation" => doc.content_generation
        }
      end
    end

    # A payload 1 byte past MAX_UPDATE_BYTES whose encoded length still fits
    # inside MAX_UPDATE_B64_BYTES must also be rejected as dropped_oversized.
    boundary = Base64.strict_encode64("x" * (YjsPersistence::MAX_UPDATE_BYTES + 1))
    assert_notification("frame_dropped.yjs", document_id: doc.id, outcome: "dropped_oversized") do
      assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
        perform :receive, {
          "type" => "update", "update" => boundary, "cid" => "x",
          "generation" => doc.content_generation
        }
      end
    end

    assert_not doc.reload.yjs_document_updates.exists?
  end

  test "valid update frame decodes base64 once at the channel boundary" do
    doc = Document.create!(title: "SingleDecode")
    subscribe slug: doc.slug
    update = build_update_b64("once")

    decode_calls = 0
    original_decode = Base64.method(:strict_decode64)
    Base64.define_singleton_method(:strict_decode64) do |*args|
      decode_calls += 1
      original_decode.call(*args)
    end
    begin
      perform :receive, {
        "type" => "update", "update" => update, "cid" => "x",
        "generation" => doc.content_generation
      }
    ensure
      Base64.define_singleton_method(:strict_decode64, original_decode)
    end

    assert_equal 1, decode_calls, "update payload should be base64-decoded exactly once"
    assert doc.reload.yjs_document_updates.exists?
  end
  test "the last unsubscribe folds the update tail into the snapshot" do
    doc = Document.create!(title: "Folded on exit")
    subscribe slug: doc.slug
    perform :receive, {
      "type" => "update", "update" => build_update_b64("typed"), "cid" => "x",
      "generation" => doc.content_generation
    }
    assert doc.reload.yjs_document_updates.exists?
    assert_nil doc.yjs_state

    unsubscribe

    doc.reload
    assert doc.yjs_state.present?, "the disconnect fold must materialize the snapshot"
    assert_not doc.yjs_document_updates.exists?
  end

  test "unsubscribing while another subscriber remains does not fold" do
    doc = Document.create!(title: "Still open")
    SyncChannel.track_subscribe(doc.id) # a second, concurrent subscriber
    subscribe slug: doc.slug
    perform :receive, {
      "type" => "update", "update" => build_update_b64("typed"), "cid" => "x",
      "generation" => doc.content_generation
    }

    unsubscribe

    assert doc.reload.yjs_document_updates.exists?, "the tail must stay unfolded while a subscriber remains"
    assert_nil doc.yjs_state
  ensure
    SyncChannel.track_unsubscribe(doc.id)
  end

  test "subscribing to a document with a corrupt blob heals instead of bricking" do
    doc = Document.create!(title: "Corrupted")
    YjsPersistence.merge(doc, build_update_b64("was here"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state: "garbage-bytes")

    subscribe slug: doc.slug

    assert subscription.confirmed?
    message = transmissions.last
    assert_equal "sync", message["type"]
    assert message.key?("update"), "the handshake must still be served after healing"
    assert doc.reload.yjs_state_archives.where(kind: "quarantine").exists?,
           "the corrupt bytes must be quarantined for forensics"
  end

  test "seed-decline releases a claim granted by this subscription's handshake" do
    doc = Document.create!(title: "Declined", seed_markdown: "# Template")

    subscribe slug: doc.slug
    assert_equal true, transmissions.last["seed"]
    assert_equal "claimed", doc.reload.seed_state

    perform :receive, { "type" => "seed-decline", "cid" => "stale-tab" }

    doc.reload
    assert_equal "pending", doc.seed_state, "a declined grant must be immediately reclaimable"
    assert_nil doc.seed_claimed_at
    assert doc.try_claim_seed, "the next claimant must win without waiting out SEED_CLAIM_TIMEOUT"
  end

  test "seed-decline without a grant leaves another claimant's seed untouched" do
    doc = Document.create!(title: "NotMine", seed_markdown: "# Template")
    assert doc.try_claim_seed, "HTTP path wins the fresh claim"

    subscribe slug: doc.slug
    assert_nil transmissions.last["seed"]

    perform :receive, { "type" => "seed-decline", "cid" => "other-tab" }

    assert_equal "claimed", doc.reload.seed_state
  end

  test "seed-decline after the seed was consumed does not re-open seeding" do
    doc = Document.create!(title: "Consumed", seed_markdown: "# Template")

    subscribe slug: doc.slug
    assert_equal true, transmissions.last["seed"]
    perform :receive, {
      "type" => "update", "update" => build_update_b64("applied template"), "cid" => "x",
      "generation" => doc.content_generation
    }
    assert_equal "seeded", doc.reload.seed_state

    perform :receive, { "type" => "seed-decline", "cid" => "x" }

    assert_equal "seeded", doc.reload.seed_state
  end

  test "seed-decline from a pre-replacement grant leaves the new generation's claim untouched" do
    doc = Document.create!(title: "Replaced", seed_markdown: "# Template")

    subscribe slug: doc.slug
    assert_equal true, transmissions.last["seed"]

    doc.replace_content!(source: "# Replacement")
    assert doc.reload.try_claim_seed, "a new claimant wins the post-replacement seed"

    perform :receive, { "type" => "seed-decline", "cid" => "stale-tab" }

    assert_equal "claimed", doc.reload.seed_state,
                 "a stale decline must not release a claim granted at a newer generation"
  end

  test "awareness messages relay without persisting" do
    doc = Document.create!(title: "Presence")
    subscribe slug: doc.slug

    assert_broadcast_on(SyncChannel.broadcasting_for(doc), type: "awareness", update: "AAAA", cid: "abc") do
      perform :receive, { "type" => "awareness", "update" => "AAAA", "cid" => "abc" }
    end

    assert_nil doc.reload.yjs_state
  end

  # --- Idea #4: Early stale-generation rejection & differential handshake ---

  test "subscribing with a stale generation immediately transmits write-denied without loading state or claiming seed" do
    doc = Document.create!(title: "Replaced", seed_markdown: "# Template")
    doc.replace_content!(source: "# New template")
    assert_equal 1, doc.reload.content_generation

    original_new = Y::Doc.method(:new)
    Y::Doc.define_singleton_method(:new) { |*| raise "stale subscribe must not build a Y::Doc" }
    begin
      subscribe slug: doc.slug, generation: 0
    ensure
      Y::Doc.define_singleton_method(:new, original_new)
    end

    assert subscription.confirmed?
    assert_equal 1, transmissions.length
    message = transmissions.last
    assert_equal "write-denied", message["type"]
    assert_equal "stale", message["reason"]
    assert_equal true, message["stale"]
    assert_equal 1, message["generation"]
    assert_equal "pending", doc.reload.seed_state, "stale reconnect must not claim the new generation's seed"
    assert_nil SyncChannel::ACTIVE_SUBSCRIBERS[doc.id], "stale reconnect must not increment subscriber count"

    unsubscribe
    assert_nil SyncChannel::ACTIVE_SUBSCRIBERS[doc.id]
  end

  test "subscribing with a matching checksum and empty tail returns a 0-byte sync without building a Y::Doc" do
    doc = Document.create!(title: "ChecksumMatch")
    YjsPersistence.merge(doc, build_update_b64("already hydrated"))
    YjsPersistence.fold!(doc)
    doc.reload

    original_new = Y::Doc.method(:new)
    Y::Doc.define_singleton_method(:new) { |*| raise "checksum match must not build a Y::Doc" }
    begin
      assert_notification("state.yjs", served_from: "checksum", blob_bytes: 0, outcome: "ok") do
        subscribe slug: doc.slug, checksum: doc.yjs_state_checksum
      end
    ensure
      Y::Doc.define_singleton_method(:new, original_new)
    end

    message = transmissions.last
    assert_equal "sync", message["type"]
    assert_equal "", message["update"]
    assert_equal Base64.strict_encode64(doc.yjs_state_vector), message["sv"]
    assert_equal doc.yjs_state_checksum, message["checksum"]
    assert_equal doc.content_generation, message["generation"]
  end

  test "subscribing with a matching checksum still diffs when unfolded updates exist" do
    doc = Document.create!(title: "ChecksumTail")
    author = Y::Doc.new
    author.get_text("t") << "initial "
    base_update = author.encode_state_as_update
    client_sv = author.encode_state_vector
    YjsPersistence.merge(doc, Base64.strict_encode64(base_update))
    YjsPersistence.fold!(doc)
    old_checksum = doc.reload.yjs_state_checksum

    author.get_text("t") << "unfolded"
    YjsPersistence.merge(doc, Base64.strict_encode64(author.encode_state_as_update(client_sv)))
    assert doc.reload.yjs_document_updates.exists?

    subscribe slug: doc.slug, checksum: old_checksum, sv: Base64.strict_encode64(client_sv)

    message = transmissions.last
    assert_equal "sync", message["type"]
    assert_not_equal "", message["update"], "unfolded tail must disable the 0-byte checksum fast path"
    assert_equal doc.reload.yjs_state_checksum, message["checksum"]

    client = Y::Doc.new
    client.apply_update(base_update)
    client.apply_update(Base64.strict_decode64(message["update"]))
    assert_equal "initial unfolded", client.get_text("t").to_s
  end

  test "a delete-only change invalidates checksum match even though state vector is unchanged" do
    doc = Document.create!(title: "DeleteChecksum")
    author = Y::Doc.new
    author.get_text("t") << "hello world"
    base_update = author.encode_state_as_update
    sv_before_delete = author.encode_state_vector
    YjsPersistence.merge(doc, Base64.strict_encode64(base_update))
    YjsPersistence.fold!(doc)
    checksum_before_delete = doc.reload.yjs_state_checksum

    author.get_text("t").delete(5, 6)
    YjsPersistence.merge(doc, Base64.strict_encode64(author.encode_state_as_update(sv_before_delete)))
    YjsPersistence.fold!(doc)
    doc.reload

    assert_equal sv_before_delete, doc.yjs_state_vector, "precondition: deletes do not advance the state vector"
    assert_not_equal checksum_before_delete, doc.yjs_state_checksum

    subscribe slug: doc.slug, checksum: checksum_before_delete, sv: Base64.strict_encode64(sv_before_delete)

    message = transmissions.last
    assert_not_equal "", message["update"]
    assert_equal doc.yjs_state_checksum, message["checksum"]

    client = Y::Doc.new
    client.apply_update(base_update)
    client.apply_update(Base64.strict_decode64(message["update"]))
    assert_equal "hello", client.get_text("t").to_s
  end

  test "subscribing with an invalid sv param falls back cleanly to full state" do
    doc = Document.create!(title: "InvalidSV")
    YjsPersistence.merge(doc, build_update_b64("full state"))
    YjsPersistence.fold!(doc)

    subscribe slug: doc.slug, sv: "not!!base64!!"

    message = transmissions.last
    assert_equal "sync", message["type"]
    client = Y::Doc.new
    client.apply_update(Base64.strict_decode64(message["update"]))
    assert_equal "full state", client.get_text("t").to_s
  end

  # --- Idea #6: Server-cached awareness, 4 KiB cap, disconnect eviction -----

  test "joining subscriber receives cached peers' awareness directly without awareness-query" do
    doc = Document.create!(title: "CachedPeers")
    YjsAwarenessCache.put(doc.id, "peer-sub", update: "PEER_A==", cid: "peer-a", client_id: 111)
    YjsAwarenessCache.put(doc.id, "self-sub", update: "SELF_B==", cid: "joiner-b", client_id: 222)

    subscribe slug: doc.slug, cid: "joiner-b", client_id: 222

    assert_equal "sync", transmissions.first["type"]
    awareness_frames = transmissions.select { |msg| msg["type"] == "awareness" }
    assert_equal [ { "type" => "awareness", "update" => "PEER_A==", "cid" => "peer-a" } ], awareness_frames
  end

  test "awareness-query messages are ignored and not broadcast" do
    doc = Document.create!(title: "NoQueryStorm")
    subscribe slug: doc.slug

    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      perform :receive, { "type" => "awareness-query", "cid" => "old-client" }
    end
  end

  test "oversized awareness frames above 4 KiB are dropped without caching or broadcasting" do
    doc = Document.create!(title: "CappedAwareness")
    subscribe slug: doc.slug, cid: "big-client", client_id: 555

    oversized = Base64.strict_encode64("x" * (SyncChannel::MAX_AWARENESS_BYTES + 1))
    assert_notification("frame_dropped.yjs", document_id: doc.id, outcome: "dropped_oversized_awareness") do
      assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
        perform :receive, { "type" => "awareness", "update" => oversized, "cid" => "big-client", "client_id" => 555 }
      end
    end
    assert_empty YjsAwarenessCache.peers_for(doc.id)

    at_limit = Base64.strict_encode64("x" * SyncChannel::MAX_AWARENESS_BYTES)
    assert_broadcast_on(SyncChannel.broadcasting_for(doc), type: "awareness", update: at_limit, cid: "big-client") do
      perform :receive, { "type" => "awareness", "update" => at_limit, "cid" => "big-client", "client_id" => 555 }
    end
    assert_equal 1, YjsAwarenessCache.peers_for(doc.id).length
  end

  test "unsubscribing while peers remain evicts awareness and broadcasts awareness-leave" do
    doc = Document.create!(title: "PeerLeave")
    SyncChannel.track_subscribe(doc.id) # another active subscriber
    subscribe slug: doc.slug, cid: "leaving-peer", client_id: 777
    perform :receive, { "type" => "awareness", "update" => "AAAA", "cid" => "leaving-peer", "client_id" => 777 }
    assert_equal 1, YjsAwarenessCache.peers_for(doc.id).length

    assert_broadcast_on(
      SyncChannel.broadcasting_for(doc),
      type: "awareness-leave", cid: "leaving-peer", client_id: 777
    ) do
      unsubscribe
    end

    assert_empty YjsAwarenessCache.peers_for(doc.id)
  ensure
    SyncChannel.track_unsubscribe(doc.id)
  end

  test "unsubscribing a replaced socket does not broadcast awareness-leave while the new socket holds client_id" do
    doc = Document.create!(title: "ReconnectOverlap")
    SyncChannel.track_subscribe(doc.id) # the newly reconnected socket
    subscribe slug: doc.slug, cid: "tab-a", client_id: 888
    perform :receive, { "type" => "awareness", "update" => "AAAA", "cid" => "tab-a", "client_id" => 888 }
    # Simulate the successor socket already publishing awareness for the same Yjs client_id.
    YjsAwarenessCache.put(doc.id, "successor-sub", update: "BBBB", cid: "tab-a", client_id: 888)

    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      unsubscribe
    end
    assert YjsAwarenessCache.active_client_id?(doc.id, 888)
  ensure
    SyncChannel.track_unsubscribe(doc.id)
  end

  test "last unsubscribe clears the document awareness cache without broadcasting" do
    doc = Document.create!(title: "LastExit")
    subscribe slug: doc.slug, cid: "solo", client_id: 999
    perform :receive, { "type" => "awareness", "update" => "AAAA", "cid" => "solo", "client_id" => 999 }
    assert_equal 1, YjsAwarenessCache.peers_for(doc.id).length

    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      unsubscribe
    end

    assert_nil YjsAwarenessCache::STORE[doc.id]
  end
end
