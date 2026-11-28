require "test_helper"

# Creating or suggesting HTML needs an account, on the live connection too.
class HtmlAccountChannelTest < ActionCable::Channel::TestCase
  tests SyncChannel

  UPDATES = JSON.parse(Rails.root.join("test/fixtures/files/html_account_updates.json").read).freeze
  include CompoundWritingHelpers

  setup do
    YjsPersistence::SEEN_HTML.clear
  end

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

  %w[text remove move break tag_text provenance_split frontmatter_plain link_attr_html].each do |name|
    test "a guest update that adds no HTML is stored: #{name}" do
      document = document_with_html
      join(document)
      assert_equal "ack", send_update(document, name)["type"]
    end
  end

  { "add" => "<i class=\"x\">", "duplicate" => "<mark>note</mark>", "change" => "<mark>other</mark>",
    "list_value" => "[\"<i>\"]" }.each do |name, value|
    test "a guest update that adds HTML is refused and not relayed: #{name}" do
      document = document_with_html
      join(document)
      rows = YjsDocumentUpdate.count
      assert_no_broadcasts(SyncChannel.broadcasting_for(document)) do
        assert_equal({ "type" => "html-refused", "seq" => 1, "html" => { value => 1 } }, send_update(document, name))
      end
      assert_equal rows, YjsDocumentUpdate.count
    end

    test "an account's update is stored: #{name}" do
      document = document_with_html
      join(document, user: account)
      assert_equal "ack", send_update(document, name)["type"]
    end
  end

  %w[unreadable mark_split_deep element_split_deep space_mark_deep frontmatter_html forged_editor_html
     unknown_mark_html_attr fm_code_fence_html fm_indented_html fm_unclosed_fence fm_delimiter].each do |name|
    test "a guest tree that cannot be read completely or adds HTML is refused: #{name}" do
      document = document_with_html
      join(document)
      assert_equal "html-refused", send_update(document, name)["type"]
    end
  end

  test "frontmatter HTML does not credit body HTML or a second frontmatter block" do
    document = Document.create!(title: "Doc", seed_content: "x")
    YjsPersistence.merge(document, UPDATES["fm_only_b"], user: account)
    join(document)
    assert_equal "html-refused", send_update(document, "fm_plus_body_b", seq: 1)["type"]
    assert_equal "html-refused", send_update(document, "fm_second_b", seq: 2)["type"]
  end

  test "a guest cannot restore HTML after an account removed it" do
    document = document_with_html
    join(document)
    assert_equal "ack", send_update(document, "text", seq: 1)["type"]
    unsubscribe

    join(document, user: account)
    assert_equal "ack", send_update(document, "remove", seq: 1)["type"]
    unsubscribe

    join(document)
    assert_equal "html-refused", send_update(document, "restore", seq: 1)["type"]
  end

  test "a guest update waits for what it depends on" do
    document = document_with_html
    join(document)
    assert_equal "retryable", send_update(document, "second")["reason"]
    assert_equal "ack", send_update(document, "first", seq: 2)["type"]
    assert_equal "html-refused", send_update(document, "second", seq: 3)["type"]
  end

  test "a guest restores HTML it removed, over either connection" do
    document = document_with_html
    join(document)
    send_update(document, "remove")
    assert_equal "ack", send_update(document, "restore", seq: 2)["type"]
  end

  test "another guest cannot add HTML that was removed before it came" do
    document = document_with_html
    join(document)
    send_update(document, "remove")
    unsubscribe
    join(document, token: "someone else")
    assert_equal "html-refused", send_update(document, "restore")["type"]
  end

  test "a guest stores a seed as it is, and no more" do
    seed = "Hello\n\nWith <mark>note</mark>\n"
    document = Document.create!(title: "Doc", seed_content: seed)
    join(document)
    claim = transmissions.last["seed_claim"]
    assert_equal "html-refused", send_update(document, "seed_with_more", "seed_claim" => claim)["type"]
    assert_equal "ack", send_update(document, "seed", seq: 2, "seed_claim" => claim)["type"]
  end

  test "a guest stores a seed whose HTML is grouped differently from Commonmarker's split" do
    document = Document.create!(title: "Doc", seed_content: "Hello\n\nWith <mark>note</mark>\n")
    join(document)
    claim = transmissions.last["seed_claim"]
    assert_equal "ack", send_update(document, "base", seq: 1, "seed_claim" => claim)["type"]
  end

  test "a guest's copy of the saved source comes back after the live state was emptied" do
    document = Document.create!(title: "Doc", seed_content: "x", content_snapshot: "Hello\n\nWith <mark>note</mark>\n",
                                seed_state: "seeded")
    join(document)
    assert_equal "ack", send_update(document, "seed")["type"]
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
