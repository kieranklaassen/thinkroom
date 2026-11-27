require "test_helper"

# Creating or suggesting HTML needs an account.
class HtmlAccountTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper
  include CompoundWritingHelpers

  UPDATES = JSON.parse(Rails.root.join("test/fixtures/files/html_account_updates.json").read).freeze
  WITH_HTML = "Hello\n\nWith <mark>note</mark>\n".freeze
  AGENT = { "X-Agent-Name" => "Scout" }.freeze

  def account
    @account ||= User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD)
  end

  def bearer
    _token, raw = CliAccessToken.issue!(user: account)
    AGENT.merge("Authorization" => "Bearer #{raw}")
  end

  def create_document(**attributes)
    Document.create!(title: "Doc", seed_content: "Hello\n", **attributes)
  end

  def sync(document, name)
    post document_sync_update_path(document.slug),
         params: { update: UPDATES.fetch(name), generation: document.content_generation }, as: :json
  end

  def snapshot(document, content)
    post document_snapshot_path(document.slug),
         params: { content:, spans: [], state_vector: Base64.strict_encode64("\x00") }, as: :json
  end

  def assert_needs_account
    assert_response :forbidden
    assert_equal "html_account_required", response.parsed_body["error_code"]
    assert_match(/account/, response.parsed_body["error"])
  end

  test "the API creates HTML for an account only" do
    assert_no_difference -> { Document.count } do
      post api_docs_path, params: { format: "html", content: "<p>hi</p>" }, headers: AGENT, as: :json
      assert_needs_account
      post api_docs_path, params: { content: WITH_HTML }, headers: AGENT, as: :json
      assert_needs_account
      post api_docs_path, params: { format: "html", content: "plain" }, headers: AGENT, as: :json
      assert_needs_account
    end
    assert_match(/login/, response.parsed_body["next_action"])

    assert_difference -> { Document.count }, 3 do
      post api_docs_path, params: { format: "html", content: "<p>hi</p>" }, headers: bearer, as: :json
      assert_response :created
      post api_docs_path, params: { content: WITH_HTML }, headers: bearer, as: :json
      assert_response :created
      post api_docs_path, params: { content: "```html\n<p>\n```\n\n`<b>`" }, headers: AGENT, as: :json
      assert_response :created
    end
  end

  test "the API ignores a browser session" do
    sign_in_as(account)
    post api_docs_path, params: { content: WITH_HTML }, headers: AGENT, as: :json
    assert_needs_account
  end

  test "a page creates a document with HTML for an account only" do
    assert_no_difference -> { Document.count } do
      post documents_path, params: { content: WITH_HTML }
      post documents_path, params: { markdown: WITH_HTML }
    end
    assert_redirected_to root_path
    assert_match(/needs an account/, session[:inertia_errors][:html_account])

    assert_difference -> { Document.count }, 1 do
      post documents_path, params: { content: "Plain `<b>`" }
    end
    sign_in_as(account)
    assert_difference -> { Document.count }, 1 do
      post documents_path, params: { content: WITH_HTML }
    end
  end

  test "an agent without an account revises around stored HTML" do
    document = create_document(seed_content: WITH_HTML)
    patch api_doc_path(document.slug), params: { content: "Changed\n\nWith <mark>note</mark> kept\n" }, headers: AGENT, as: :json
    assert_response :success
    patch api_doc_path(document.slug), params: { replaces: "Changed", with: "Again" }, headers: AGENT, as: :json
    assert_response :success
    assert_equal "Again\n\nWith <mark>note</mark> kept\n", document.reload.seed_content

    [ { content: "#{WITH_HTML}\n<i>x</i>" }, { content: WITH_HTML.sub("<mark>", "<mark id=x>") },
      { content: WITH_HTML * 2 }, { replaces: "Again", with: "<b>Again</b>" } ].each do |params|
      patch api_doc_path(document.slug), params:, headers: AGENT, as: :json
      assert_needs_account
    end
    assert_equal "Again\n\nWith <mark>note</mark> kept\n", document.reload.seed_content
    patch api_doc_path(document.slug), params: { content: "No HTML left\n" }, headers: AGENT, as: :json
    assert_response :success
  end

  test "an HTML document is revised by its account, and retitled by anyone who could" do
    document = Document.create!(title: "H", content_format: "html", seed_content: "<p>hi</p>")
    patch api_doc_path(document.slug), params: { content: "<p>bye</p>" }, headers: AGENT, as: :json
    assert_needs_account
    patch api_doc_path(document.slug), params: { content: "plain" }, headers: AGENT, as: :json
    assert_needs_account
    patch api_doc_path(document.slug), params: { title: "New <b>" }, headers: AGENT, as: :json
    assert_response :success
    document.update!(user: account, owner_name: account.name)
    patch api_doc_path(document.slug), params: { content: "<p>bye</p>" }, headers: bearer, as: :json
    assert_response :success
  end

  test "the API takes an HTML suggestion from an account only" do
    document = create_document
    html = Document.create!(title: "H", content_format: "html", seed_content: "<p>hi</p>")
    { document => "Use <b>this</b>", html => "<p>this</p>" }.each do |doc, body|
      assert_no_difference -> { Suggestion.count } do
        post api_doc_suggestions_path(doc.slug), params: { body: }, headers: AGENT, as: :json
        assert_needs_account
      end
      post api_doc_suggestions_path(doc.slug), params: { body: }, headers: bearer, as: :json
      assert_response :created
      post api_doc_suggestions_path(doc.slug), params: { body: "Plain words" }, headers: AGENT, as: :json
      assert_response :created
    end
  end

  test "a page takes an HTML suggestion from an account only" do
    document = create_document
    assert_no_difference -> { Suggestion.count } do
      post document_suggestions_path(document.slug), params: { body: "Use <b>this</b>" }
    end
    assert_match(/needs an account/, session[:inertia_errors][:html_account])
    post document_suggestions_path(document.slug), params: { body: "Use `<b>` **this**" }
    assert_equal 1, document.suggestions.count
    sign_in_as(account)
    post document_suggestions_path(document.slug), params: { body: "Use <b>this</b>" }
    assert_equal 2, document.suggestions.count
  end

  test "a guest cannot accept an HTML suggestion, and accepts the rest" do
    document = create_document
    html = document.suggestions.create!(author_name: "A", author_kind: "agent", body: "<b>x</b>")
    plain = document.suggestions.create!(author_name: "A", author_kind: "agent", body: "x")

    patch accept_suggestion_path(html)
    assert_equal "pending", html.reload.status
    patch accept_suggestion_path(html), headers: { "Accept" => "application/json" }
    assert_needs_account

    patch accept_all_document_suggestions_path(document.slug), params: {}, as: :json
    assert_equal [ plain.id ], response.parsed_body["accepted"].pluck("id")
    assert_equal 1, response.parsed_body["needs_account"]
    assert_equal "pending", html.reload.status
    patch reject_suggestion_path(html)
    assert_equal "rejected", html.reload.status
    html.update!(status: "pending")

    sign_in_as(account)
    patch accept_all_document_suggestions_path(document.slug), params: {}, as: :json
    assert_equal [ html.id ], response.parsed_body["accepted"].pluck("id")
  end

  test "a guest cannot accept into an HTML document" do
    document = Document.create!(title: "H", content_format: "html", seed_content: "<p>hi</p>")
    suggestion = document.suggestions.create!(author_name: "A", author_kind: "agent", body: "words")
    patch accept_suggestion_path(suggestion), headers: { "Accept" => "application/json" }
    assert_needs_account
    patch accept_all_document_suggestions_path(document.slug), params: {}, as: :json
    assert_empty response.parsed_body["accepted"]
    assert_equal "pending", suggestion.reload.status
  end

  test "a guest saves live Markdown edits beside stored HTML, and cannot add any" do
    document = create_document(content_snapshot: WITH_HTML)
    YjsPersistence.merge(document, UPDATES["base"], user: account)
    sync(document, "text")
    assert_response :no_content
    sync(document, "add")
    assert_needs_account
    assert_equal({ "<i class=\"x\">" => 1 }, response.parsed_body["html"])
    sync(document, "duplicate")
    assert_needs_account
    sync(document, "change")
    assert_needs_account
    sync(document, "second")
    assert_response :conflict
    sign_in_as(account)
    sync(document, "add")
    assert_response :no_content
  end

  test "a refused update is not relayed, and its source is not saved" do
    document = create_document
    assert_no_broadcasts(SyncChannel.broadcasting_for(document)) do
      post document_sync_update_path(document.slug), params: {
        update: UPDATES["base"], generation: 0, content: WITH_HTML, spans: [], state_vector: Base64.strict_encode64("\x00")
      }, as: :json
    end
    assert_needs_account
    assert_nil document.reload.content_snapshot
    assert_not document.live_crdt?
  end

  test "a guest restores HTML it removed in this session" do
    document = create_document
    YjsPersistence.merge(document, UPDATES["base"], user: account)
    get document_page_path(document.slug)
    sync(document, "remove")
    assert_response :no_content
    sync(document, "restore")
    assert_response :no_content
  end

  test "a guest snapshot keeps existing HTML and adds none" do
    document = create_document(content_snapshot: WITH_HTML)
    snapshot(document, "Hi\n\nWith <mark>note</mark> more\n")
    assert_response :success
    [ "<b>x</b>", "#{WITH_HTML}\n<!-- c -->", "#{WITH_HTML}\n</div>", WITH_HTML.sub("mark", "mark onclick=x") ].each do |content|
      snapshot(document, content)
      assert_needs_account
    end
    assert_equal "Hi\n\nWith <mark>note</mark> more\n", document.reload.content_snapshot
    snapshot(document, '<span data-provenance data-kind="human" data-author="G" data-state="verbatim">Hi</span>')
    assert_response :success
    sign_in_as(account)
    snapshot(document, "<b>x</b>")
    assert_response :success
  end

  test "a guest snapshot may hold HTML an account added live" do
    document = create_document(content_snapshot: "Hello\n")
    YjsPersistence.merge(document, UPDATES["base"], user: account)
    ydoc = Y::Doc.new
    ydoc.apply_update(Base64.strict_decode64(UPDATES["base"]))
    post document_snapshot_path(document.slug), params: {
      content: "Hello\n\nWith <mark>note</mark>\n", spans: [], state_vector: Base64.strict_encode64(ydoc.encode_state_vector)
    }, as: :json
    assert_response :success
  end

  test "an HTML document is read and commented on without an account, not edited" do
    document = Document.create!(title: "H", content_format: "html", seed_content: "<p>hi</p>", content_snapshot: "<p>hi</p>")
    get document_page_path(document.slug)
    assert_response :success
    assert_not document.ownership_props("guest")[:can_write]
    assert document.ownership_props("guest")[:html_needs_account]
    get document_mode_path(document.slug, "edit")
    assert_redirected_to document_page_path(document.slug)
    get document_mode_path(document.slug, "comment")
    assert_response :success
    post document_comments_path(document.slug), params: { body: "a <b>" }
    assert_equal 1, document.comments.count
    sync(document, "plain")
    assert_needs_account
    snapshot(document, "<p>bye</p>")
    assert_needs_account
    post document_snapshot_path(document.slug), params: { content: "<p>bye</p>" }, as: :json
    assert_needs_account
    assert_equal "<p>hi</p>", document.reload.content_snapshot

    sign_in_as(account)
    get document_mode_path(document.slug, "edit")
    assert_response :success
    assert_not document.ownership_props(nil, viewer_user: account)[:html_needs_account]
  end

  test "a guest who owns an HTML document still manages it" do
    document = Document.create!(title: "H", content_format: "html", seed_content: "<p>hi</p>")
    post claim_document_path(document.slug), params: { name: "G" }
    patch document_archive_path(document.slug), params: { archived: true }
    assert document.reload.archived_at
    delete destroy_document_path(document.slug)
    assert_not Document.exists?(document.id)
  end
end
