require "test_helper"

class HtmlAccountTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper
  include CompoundWritingHelpers

  UPDATES = JSON.parse(Rails.root.join("test/fixtures/files/html_account_updates.json").read).freeze
  WITH_HTML = "Hello\n\nWith <mark>note</mark>\n".freeze
  AGENT = { "X-Agent-Name" => "Scout" }.freeze
  BROWSER = { "User-Agent" => "Mozilla/5.0" }.freeze

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

  test "an agent revises Markdown without HTML, and its account revises the rest" do
    document = create_document
    patch api_doc_path(document.slug), params: { content: "Changed `<b>`\n" }, headers: AGENT, as: :json
    assert_response :success
    [ { content: WITH_HTML }, { replaces: "Changed", with: "<b>Changed</b>" } ].each do |params|
      patch api_doc_path(document.slug), params:, headers: AGENT, as: :json
      assert_needs_account
    end
    assert_equal "Changed `<b>`\n", document.reload.seed_content

    document.update!(seed_content: WITH_HTML)
    [ { content: WITH_HTML }, { content: "No HTML left\n" }, { replaces: "Hello", with: "Again" } ].each do |params|
      patch api_doc_path(document.slug), params:, headers: AGENT, as: :json
      assert_needs_account
    end
    assert_equal WITH_HTML, document.reload.seed_content
    get api_doc_path(document.slug), headers: AGENT, as: :json
    assert_not response.parsed_body.dig("ownership", "can_write")
    assert response.parsed_body.dig("ownership", "html_needs_account")
    assert_equal WITH_HTML, response.parsed_body["content"]
    patch api_doc_path(document.slug), params: { title: "New" }, headers: AGENT, as: :json
    assert_response :success

    patch api_doc_path(document.slug), params: { replaces: "Hello", with: "<b>Again</b>" }, headers: bearer, as: :json
    assert_response :success
  end

  test "an HTML document is revised by its account, and retitled by anyone who could" do
    document = Document.create!(title: "H", content_format: "html", seed_content: "<p>hi</p>")
    get api_doc_path(document.slug), headers: AGENT, as: :json
    assert_not response.parsed_body.dig("ownership", "can_write")
    assert response.parsed_body.dig("ownership", "html_needs_account")
    get api_doc_path(document.slug), headers: bearer, as: :json
    assert response.parsed_body.dig("ownership", "can_write")
    assert_not response.parsed_body.dig("ownership", "html_needs_account")

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
    raw = create_document(seed_content: WITH_HTML)
    post api_doc_suggestions_path(document.slug), params: { body: "Plain words `<b>`" }, headers: AGENT, as: :json
    assert_response :created
    { document => "Use <b>this</b>", html => "<p>this</p>", raw => "Plain words" }.each do |doc, body|
      assert_no_difference -> { Suggestion.count } do
        post api_doc_suggestions_path(doc.slug), params: { body: }, headers: AGENT, as: :json
        assert_needs_account
      end
      post api_doc_suggestions_path(doc.slug), params: { body: }, headers: bearer, as: :json
      assert_response :created
    end
    [ html, raw ].each do |doc|
      post api_doc_suggestions_path(doc.slug), params: { body: "words" }, headers: AGENT, as: :json
      assert_needs_account
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
    raw = create_document(seed_content: WITH_HTML)
    post document_suggestions_path(raw.slug), params: { body: "words" }
    assert_equal 0, raw.suggestions.count
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

  { "an HTML document" => { content_format: "html", seed_content: "<p>hi</p>" },
    "Markdown with HTML" => { seed_content: WITH_HTML } }.each do |name, attributes|
    test "a guest reviews no suggestion in #{name}" do
      document = create_document(**attributes)
      suggestion = document.suggestions.create!(author_name: "A", author_kind: "agent", body: "words")
      [ accept_suggestion_path(suggestion), reject_suggestion_path(suggestion),
        accept_all_document_suggestions_path(document.slug) ].each do |path|
        patch path, headers: { "Accept" => "application/json" }
        assert_needs_account
      end
      assert_equal "pending", suggestion.reload.status
    end

    test "a guest reads and comments on #{name}, and does not edit it" do
      document = create_document(**attributes)
      get document_page_path(document.slug), headers: BROWSER
      assert_response :success
      assert_equal "pending", document.reload.seed_state
      assert_not document.ownership_props("guest")[:can_write]
      assert document.ownership_props("guest")[:html_needs_account]
      %w[edit suggest].each do |mode|
        get document_mode_path(document.slug, mode), headers: BROWSER
        assert_redirected_to document_page_path(document.slug)
      end
      get document_mode_path(document.slug, "comment"), headers: BROWSER
      assert_response :success
      post document_comments_path(document.slug), params: { body: "a <b>" }
      assert_equal 1, document.comments.count
      patch document_highlight_names_path(document.slug), params: { names: { yellow: "Note" } }, as: :json
      assert_needs_account
      sync(document, "plain")
      assert_needs_account
      snapshot(document, "words")
      assert_needs_account
      assert_not document.reload.live_crdt?
      assert_nil document.content_snapshot

      sign_in_as(account)
      get document_mode_path(document.slug, "edit"), headers: BROWSER
      assert_response :success
      assert_not document.ownership_props(nil, viewer_user: account)[:html_needs_account]
    end
  end

  test "a guest does not edit a live document with HTML, whatever its saved source holds" do
    document = create_document(content_snapshot: "Hello\n")
    YjsPersistence.merge(document, UPDATES["base"], user: account)
    %w[text remove add change].each do |name|
      sync(document, name)
      assert_needs_account
    end
    snapshot(document, "Hello\n")
    assert_needs_account
    get document_mode_path(document.slug, "edit"), headers: BROWSER
    assert_redirected_to document_page_path(document.slug)
    sign_in_as(account)
    sync(document, "text")
    assert_response :no_content
  end

  test "a guest saves a plain document with code, and no HTML" do
    document = create_document
    snapshot(document, "Hi `<b>`\n\n```html\n<p>\n```\n")
    assert_response :success
    [ "<b>x</b>", "<!-- c -->", "<div>#{"1 < 2 " * 12}<a href=\"https://example.com\" x=\"" ].each do |content|
      snapshot(document, content)
      assert_needs_account
    end
    snapshot(document, '<span data-provenance data-kind="human" data-author="G" data-state="verbatim">Hi</span>')
    assert_response :success
    sync(document, "second")
    assert_response :conflict
    sign_in_as(account)
    snapshot(document, "<b>x</b>")
    assert_response :success
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

  test "an update whose source is refused is not stored" do
    document = create_document
    assert_no_broadcasts(SyncChannel.broadcasting_for(document)) do
      post document_sync_update_path(document.slug), params: {
        update: UPDATES["plain"], generation: 0, content: WITH_HTML, spans: [], state_vector: Base64.strict_encode64("\x00")
      }, as: :json
    end
    assert_needs_account
    assert_not document.reload.live_crdt?
  end

  test "signing out disconnects open Action Cable connections for the account" do
    user = account
    sign_in_as(user)
    disconnected = false
    fake_remote = Object.new
    fake_remote.define_singleton_method(:disconnect) { disconnected = true }
    fake_collection = Object.new
    fake_collection.define_singleton_method(:where) do |identifiers|
      fake_remote if identifiers[:current_user] == user
    end
    original = ActionCable.server.method(:remote_connections)
    ActionCable.server.define_singleton_method(:remote_connections) { fake_collection }
    begin
      delete logout_path
    ensure
      ActionCable.server.define_singleton_method(:remote_connections, original)
    end
    assert_redirected_to root_path
    assert disconnected
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
