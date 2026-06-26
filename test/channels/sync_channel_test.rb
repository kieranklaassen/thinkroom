require "test_helper"

class SyncChannelTest < ActionCable::Channel::TestCase
  def build_update_b64(text)
    ydoc = Y::Doc.new
    ydoc.get_text("t") << text
    Base64.strict_encode64(ydoc.diff.pack("C*"))
  end

  def build_sequential_updates
    ydoc = Y::Doc.new
    text = ydoc.get_text("t")
    before_first = ydoc.state
    text << "a"
    first = ydoc.diff(before_first)
    before_second = ydoc.state
    text << "b"
    second = ydoc.diff(before_second)
    [ first, second ].map { |update| Base64.strict_encode64(update.pack("C*")) }
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
    assert_equal "# Template", transmissions.last["seed_markdown"]

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
      perform :receive, { "type" => "update", "update" => update, "cid" => "abc" }
    end

    assert doc.reload.yjs_state.present?
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
      perform :receive, { "type" => "update", "update" => update, "cid" => "reader" }
    end

    assert_nil doc.reload.yjs_state
    assert_equal "write-denied", transmissions.last["type"]
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
      perform :receive, { "type" => "update", "update" => update, "cid" => "owner" }
    end
    assert doc.reload.yjs_state.present?
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

    original_merge = YjsPersistence.method(:merge)
    YjsPersistence.define_singleton_method(:merge) { |*| raise "storage unavailable" }
    begin
      assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
        perform :receive, { "type" => "update", "update" => update, "cid" => "x" }
      end
    ensure
      YjsPersistence.define_singleton_method(:merge, original_merge)
    end

    assert_nil doc.reload.yjs_state
  end

  test "sequenced updates are persisted and relayed in client order" do
    doc = Document.create!(title: "Ordered relay")
    subscribe slug: doc.slug
    first, second = build_sequential_updates

    assert_no_broadcasts(SyncChannel.broadcasting_for(doc)) do
      perform :receive, {
        "type" => "update", "update" => second, "cid" => "x", "seq" => 2
      }
    end

    assert_broadcasts SyncChannel.broadcasting_for(doc), 2 do
      perform :receive, {
        "type" => "update", "update" => first, "cid" => "x", "seq" => 1
      }
    end

    persisted = Y::Doc.new
    persisted.sync(doc.reload.yjs_state.unpack("C*"))
    assert_equal "ab", persisted.get_text("t").to_s
  end

  test "first subscriber still gets the seed after an empty sync-reply was merged" do
    doc = Document.create!(title: "Race", seed_markdown: "# Template")
    subscribe slug: doc.slug

    # A joining client with an empty doc replies with a no-op update.
    empty_update = Base64.strict_encode64(Y::Doc.new.full_diff.pack("C*"))
    perform :receive, { "type" => "sync-reply", "update" => empty_update, "cid" => "x" }

    # The claim is consumed but reclaimable after timeout because the no-op
    # merge did not flip seed_state to "seeded".
    travel Document::SEED_CLAIM_TIMEOUT + 1.second do
      unsubscribe
      subscribe slug: doc.slug
      assert_equal true, transmissions.last["seed"], "doc must remain seedable after a no-op merge"
    end
  end

  test "awareness messages relay without persisting" do
    doc = Document.create!(title: "Presence")
    subscribe slug: doc.slug

    assert_broadcast_on(SyncChannel.broadcasting_for(doc), type: "awareness", update: "AAAA", cid: "abc") do
      perform :receive, { "type" => "awareness", "update" => "AAAA", "cid" => "abc" }
    end

    assert_nil doc.reload.yjs_state
  end
end
