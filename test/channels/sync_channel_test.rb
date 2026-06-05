require "test_helper"

class SyncChannelTest < ActionCable::Channel::TestCase
  def build_update_b64(text)
    ydoc = Y::Doc.new
    ydoc.get_text("t") << text
    Base64.strict_encode64(ydoc.diff.pack("C*"))
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
    assert_equal "# Template", transmissions.last["seed_markdown"]

    unsubscribe
    subscribe slug: doc.slug
    assert_nil transmissions.last["seed"]
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

  test "first subscriber still gets the seed after an empty sync-reply was merged" do
    doc = Document.create!(title: "Race", seed_markdown: "# Template")
    subscribe slug: doc.slug

    # A joining client with an empty doc replies with a no-op update.
    empty_update = Base64.strict_encode64(Y::Doc.new.full_diff.pack("C*"))
    perform :receive, { "type" => "sync-reply", "update" => empty_update, "cid" => "x" }

    # The claim is consumed but reclaimable after timeout because the no-op
    # merge did not flip seed_state to "seeded".
    travel SyncChannel::SEED_CLAIM_TIMEOUT + 1.second do
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
