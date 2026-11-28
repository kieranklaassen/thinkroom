require "test_helper"

# Creating or suggesting HTML needs an account, on the live connection too.
class HtmlAccountChannelTest < ActionCable::Channel::TestCase
  tests SyncChannel

  UPDATES = JSON.parse(Rails.root.join("test/fixtures/files/html_account_updates.json").read).freeze
  include CompoundWritingHelpers

  def account
    @account ||= User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD)
  end

  def join(document, user: nil, token: "guest")
    stub_connection(current_user: user, owner_token: token)
    subscribe slug: document.slug
  end

  def document_with_html
    Document.create!(title: "Doc", seed_content: "x").tap do |document|
      YjsPersistence.merge(document, UPDATES["base"], user: account)
    end
  end

  def send_update(document, name, seq: 1, **extra)
    perform :receive, {
      "type" => "update", "update" => UPDATES.fetch(name), "cid" => "c", "seq" => seq,
      "generation" => document.content_generation, **extra
    }
    transmissions.last
  end

  def plain_document
    Document.create!(title: "Doc", seed_content: "x").tap do |document|
      YjsPersistence.merge(document, UPDATES["base"], user: account)
      YjsPersistence.merge(document, UPDATES["remove"], user: account)
    end
  end

  %w[text break tag_text provenance_split frontmatter_plain link_attr_html unknown_mark_html_attr].each do |name|
    test "a guest update to a plain document is stored: #{name}" do
      document = plain_document
      join(document)
      assert_equal "ack", send_update(document, name)["type"]
    end
  end

  %w[add duplicate list_value restore frontmatter_html fm_code_fence_html fm_unclosed_fence].each do |name|
    test "a guest update that brings HTML is refused and not relayed: #{name}" do
      document = plain_document
      join(document)
      rows = YjsDocumentUpdate.count
      assert_no_broadcasts(SyncChannel.broadcasting_for(document)) do
        assert_equal({ "type" => "html-refused", "seq" => 1 }, send_update(document, name))
      end
      assert_equal rows, YjsDocumentUpdate.count
    end

    test "an account's update is stored: #{name}" do
      document = plain_document
      join(document, user: account)
      assert_equal "ack", send_update(document, name)["type"]
    end
  end

  %w[text remove move change break unreadable mark_split_deep element_split_deep space_mark_deep].each do |name|
    test "a guest update to a live document with HTML is refused: #{name}" do
      document = document_with_html
      join(document)
      assert_equal "html-refused", send_update(document, name)["type"]
    end
  end

  test "a guest update is refused while the saved source holds HTML" do
    document = plain_document
    document.update!(content_snapshot: "With <mark>note</mark>")
    join(document)
    assert_equal "html-refused", send_update(document, "text")["type"]
    document.update!(content_snapshot: "With `<mark>`")
    assert_equal "ack", send_update(document, "text", seq: 2)["type"]
  end

  test "a guest edits again only after an account removed the HTML, and cannot restore it" do
    document = document_with_html
    join(document)
    assert_equal "html-refused", send_update(document, "text")["type"]
    unsubscribe

    join(document, user: account)
    assert_equal "ack", send_update(document, "remove")["type"]
    unsubscribe

    join(document)
    assert_equal "ack", send_update(document, "text")["type"]
    assert_equal "html-refused", send_update(document, "restore", seq: 2)["type"]
  end

  test "a guest update waits for what it depends on" do
    document = plain_document
    join(document)
    assert_equal "retryable", send_update(document, "second")["reason"]
    assert_equal "ack", send_update(document, "first", seq: 2)["type"]
    assert_equal "html-refused", send_update(document, "second", seq: 3)["type"]
  end

  [ "Hello\n\nWith <mark>note</mark>\n", "---\nnote: <mark>note</mark>\n---\n\nHello\n" ].each do |seed|
    test "a guest reads a seed with HTML and does not store it: #{seed.lines.first.strip}" do
      document = Document.create!(title: "Doc", seed_content: seed)
      join(document)
      assert_nil transmissions.last["seed"]
      assert_equal seed, transmissions.last["seed_content"]
      assert_equal "html-refused", send_update(document, "seed")["type"]
      assert_not document.reload.live_crdt?
    end
  end

  test "a guest does not edit an HTML document and gets no seed claim for it" do
    document = Document.create!(title: "H", content_format: "html", seed_content: "<p>hi</p>")
    join(document)
    assert_nil transmissions.last["seed"]
    assert_equal "<p>hi</p>", transmissions.last["seed_content"]
    assert_equal "html-refused", send_update(document, "plain")["type"]
    join(document, user: account)
    assert transmissions.last["seed"]
  end
end
