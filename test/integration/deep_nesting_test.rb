require "test_helper"
require_relative "../test_helpers/own_process_helpers"

# Very deep nesting is handled: a document that cannot be formatted is read as
# its source, and a write that cannot be checked gets a reason and stores nothing.
class DeepNestingTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers
  include OwnProcessHelpers

  BROWSER = { "User-Agent" => "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" }.freeze
  AGENT = { "X-Agent-Name" => "Scout" }.freeze
  MARKDOWN = "#{">" * 500} words <b>&amp; \"more\"</b>".freeze
  HTML = "#{"<blockquote>" * 1_000}words".freeze

  # Its text can be read; only the preview, which keeps raw HTML, cannot be formatted.
  PREVIEW_ONLY = "#{"<div>" * 1_000}words & more".freeze

  SHAPES = {
    "quotes" => MARKDOWN,
    "lists" => (0...600).map { |level| "#{"  " * level}- words" }.join("\n"),
    "emphasis" => "#{"*" * 2_000}words#{"*" * 2_000}",
    "mixed emphasis" => "#{"~~a *" * 500}words#{"*~~" * 500}",
    "a Mermaid fence" => "#{MARKDOWN}\n\n```mermaid\ngraph TD\n```",
    "a null character" => "#{">" * 500} words\0"
  }.freeze

  SHAPES.each do |name, content|
    test "a document with #{name} is read everywhere as its source" do
      document = deep_document(content)
      assert_includes document.plain_text, "words"
      assert_equal "Deep", document.display_title
      assert_equal "Deep", DocumentSocialPreview.new(document).title
      assert_equal 0, MarkdownSketchAudit.call(content).fence_count

      get document_page_path(document.slug), headers: BROWSER
      assert_source_page(content)
      [ api_doc_path(document.slug), document_page_path(document.slug, format: :json) ].each do |path|
        get path
        assert_response :success
        assert_equal content, response.parsed_body["content"]
      end
      get document_page_path(document.slug, format: :txt)
      assert_response :success
      assert_equal content, document.reload.current_content
    end
  end

  test "nested brackets, links and raw HTML have an answer" do
    [ "#{"[" * 1_000}words#{"](u)" * 1_000}", "#{"[" * 1_000}words", "#{"<div>" * 1_000}words", "a #{"<span>" * 1_000}words" ].each do |content|
      get document_page_path(deep_document(content).slug), headers: BROWSER
      assert_response :success
    end
  end

  test "the source page shows the source as text, with no script and no seed claim" do
    sign_in_as(User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD))
    content = "#{MARKDOWN}</pre></template><script>alert(1)</script><img src=x onerror=alert(1)>"
    document = Document.create!(title: "</title><script>alert(2)</script>", seed_content: content)
    [ document_page_path(document.slug), document_mode_path(document.slug, "edit"), document_mode_path(document.slug, "comment") ].each do |path|
      get path, headers: BROWSER
      assert_source_page(content)
      assert_select "script[src], script[type=module]", 0
      assert_select "img[onerror]", 0
      assert_not_includes response.body, "<script>alert"
      assert_select "a[href=?]", document_page_path(document.slug, format: :txt)
      assert_equal "text/html; charset=utf-8", response.headers["Content-Type"]
      assert_no_match(/alert/, response.headers.to_h.values.join)
    end
    assert_equal "pending", document.reload.seed_state
  end

  test "a source that begins with empty lines is shown" do
    get document_page_path(deep_document("\n\n#{MARKDOWN}").slug), headers: BROWSER
    assert_source_page("\n\n#{MARKDOWN}")
  end

  test "an Inertia visit goes to the source page" do
    sign_in_as(User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD))
    document = deep_document(MARKDOWN)
    [ {}, partial("document", component: "documents/index") ].each do |headers|
      get document_mode_path(document.slug, "edit"), headers: inertia(headers)
      assert_response :conflict
      assert_equal document_mode_url(document.slug, "edit"), response.headers["X-Inertia-Location"]
    end
    assert_equal "pending", document.reload.seed_state
  end

  # What an open editor asks for when access changes, when an update is denied,
  # and for anything else it reloads.
  [ "document,ownership", "document,ownership,viewer", "document", "document.title", "suggestions,comments" ].each do |props|
    test "a partial reload of #{props} answers the open page" do
      sign_in_as(User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD))
      document = live_document
      post document_snapshot_path(document.slug),
           params: { content: PREVIEW_ONLY, state_vector: encode(live_ydoc.encode_state_vector) }, as: :json
      assert_response :success
      assert_not document.reload.formattable?

      get document_mode_path(document.slug, "edit"), headers: inertia(partial(props))
      assert_response :success
      loaded = response.parsed_body.dig("props", "document")
      next assert_nil(loaded) unless props.include?("document")
      assert_equal document.title, loaded["title"]
      next if props == "document.title"

      assert_equal "<pre><code>#{ERB::Util.html_escape(PREVIEW_ONLY)}</code></pre>", loaded["content_html"]
      assert_kind_of Integer, loaded["content_blocks"]
      assert_equal [ nil, false ], loaded.values_at("seed_content", "seed_granted")
      assert loaded["yjs_state_b64"].present?
      assert_equal document.title, loaded["display_title"]
    end
  end

  test "a partial reload that leaves the document out answers the open page" do
    get document_page_path(deep_document(MARKDOWN).slug),
        headers: inertia(partial(nil).merge("X-Inertia-Partial-Except" => "document"))
    assert_response :success
    assert_nil response.parsed_body.dig("props", "document")
  end

  test "an access change is in the partial reload it causes" do
    document = live_document(link_access: "edit", owner_token: "someone")
    document.update!(content_snapshot: PREVIEW_ONLY)
    document.update!(link_access: "view")
    get document_page_path(document.slug), headers: inertia(partial("document,ownership"))
    assert_response :success
    assert_not response.parsed_body.dig("props", "ownership", "can_write")
    assert_includes response.parsed_body.dig("props", "document", "content_html"), "&lt;div&gt;"
  end

  test "a source stored through the API that only its preview cannot format has the source page" do
    agent = account_agent
    post api_docs_path, params: { content: PREVIEW_ONLY }, as: :json, headers: agent
    assert_response :created
    get document_page_path(response.parsed_body["slug"]), headers: BROWSER
    assert_source_page(PREVIEW_ONLY)
  end

  test "images are claimed from html over the limits as none" do
    document = Document.create!(title: "Page", content_format: "html", seed_content: "<p>kept</p>")
    source = %(#{HTML}<img src="/rails/active_storage/blobs/redirect/x/a.png">)
    assert_nothing_raised { DocumentAsset.claim_from_html!(document:, source:) }
  end

  test "the source page keeps the checks of the document page" do
    get document_page_path("missing"), headers: BROWSER
    assert_response :not_found

    locked = deep_document(MARKDOWN, link_access: "view", owner_token: "someone")
    get document_mode_path(locked.slug, "edit"), headers: BROWSER
    assert_redirected_to document_page_path(locked.slug)
    get document_page_path(locked.slug, mode: "read"), headers: BROWSER
    get document_page_path(locked.slug), headers: BROWSER
    assert_source_page(MARKDOWN)

    get document_page_path(locked.slug), headers: { "User-Agent" => "curl/8" }
    assert_equal "text/plain", response.media_type
    get document_page_path(locked.slug), headers: { "User-Agent" => "Slackbot-LinkExpanding Mozilla" }
    assert_source_page(MARKDOWN)
    assert_select "meta[property='og:title'][content=?]", "Deep"

    user = User.create!(name: "Owner", email: "owner-deep@example.com", password: PASSWORD)
    owned = deep_document(MARKDOWN, user:, owner_name: user.name, link_access: "view")
    get document_mode_path(owned.slug, "edit"), headers: BROWSER
    assert_redirected_to document_page_path(owned.slug)
    sign_in_as(user)
    get document_mode_path(owned.slug, "edit"), headers: BROWSER
    assert_source_page(MARKDOWN)
    assert_equal [ user.id, "view", "pending" ], owned.reload.values_at(:user_id, :link_access, :seed_state)
  end

  test "the preview image answers" do
    drawn = []
    original = DocumentOgImage.method(:call)
    DocumentOgImage.define_singleton_method(:call) do |document|
      drawn << send(:svg, document)
      "\x89PNG\r\n\x1A\nstub".b
    end
    get document_og_image_path(deep_document(MARKDOWN).slug)
    assert_response :success
    assert_equal "image/png", response.media_type
    assert_includes drawn.sole, ">Deep</tspan>"
  ensure
    DocumentOgImage.define_singleton_method(:call, original)
  end

  # In its own process, as the preview image's own test renders it.
  test "the preview image renders" do
    script = <<~RUBY
      document = Document.new(title: "Deep", content_format: "markdown", seed_content: STDIN.read)
      image = Vips::Image.new_from_buffer(DocumentOgImage.call(document), "")
      puts JSON.generate([ image.get("vips-loader"), image.width, image.height ])
    RUBY
    stdout = run_in_own_rails(script, stdin_data: MARKDOWN)
    assert_equal [ "pngload_buffer", DocumentOgImage::WIDTH, DocumentOgImage::HEIGHT ], JSON.parse(stdout)
  end

  test "browser create stores the source as sent" do
    sign_in_as(User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD))
    assert_difference -> { Document.count } do
      post documents_path, params: { content: MARKDOWN }
    end
    assert_response :see_other
    follow_redirect! headers: BROWSER.dup
    assert_source_page(MARKDOWN)
    assert_equal MARKDOWN, Document.last.seed_content
  end

  { "markdown" => MARKDOWN, "html" => HTML }.each do |format, content|
    test "API create and update of #{format} give a reason and store nothing" do
      agent = account_agent
      assert_no_difference -> { Document.count } do
        post api_docs_path, params: { content:, format: }, as: :json, headers: agent
      end
      assert_refused

      document = Document.create!(title: "Kept", content_format: format, seed_content: "kept")
      patch api_doc_path(document.slug), params: { content: }, as: :json, headers: agent
      assert_refused
      patch api_doc_path(document.slug), params: { replaces: "kept", with: content }, as: :json, headers: agent
      assert_refused
      assert_equal "kept", document.reload.current_content
      assert_empty document.activities
    end

    test "a #{format} snapshot gives a reason and a live document keeps its last one" do
      sign_in_as(User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD))
      ydoc = live_ydoc
      document = live_document(content_format: format, content_snapshot: "good")

      post document_snapshot_path(document.slug), params: { content:, state_vector: encode(ydoc.encode_state_vector) }, as: :json
      assert_refused

      ydoc.get_text("t") << " more"
      post document_sync_update_path(document.slug), as: :json, params: {
        update: encode(ydoc.encode_state_as_update), generation: 0, cid: "c", content:, state_vector: encode(ydoc.encode_state_vector)
      }
      assert_refused
      assert_equal 1, document.yjs_document_updates.count
      assert_equal [ "good", "Live" ], document.reload.values_at(:content_markdown, :title)

      get document_mode_path(document.slug, "edit"), headers: inertia
      assert_response :success
      assert response.parsed_body.dig("props", "document", "yjs_state_b64").present?
    end
  end

  test "an html suggestion gives a reason and is not stored" do
    user = User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD)
    agent = AGENT.merge("Authorization" => "Bearer #{CliAccessToken.issue!(user:).last}")
    document = Document.create!(title: "Page", content_format: "html", seed_content: "<p>kept</p>")
    post api_doc_suggestions_path(document.slug), params: { body: HTML }, as: :json, headers: agent
    assert_refused
    sign_in_as(user)
    post document_suggestions_path(document.slug), params: { body: HTML }
    assert_redirected_to document_page_path(document.slug)
    get document_page_path(document.slug), headers: inertia
    assert_equal DocumentHtml::TooComplex::MESSAGE, response.parsed_body.dig("props", "errors", "suggestion")
    assert_empty document.suggestions
  end

  test "a markdown suggestion is stored as sent" do
    agent = account_agent
    document = Document.create!(title: "Page", seed_content: "words")
    post api_doc_suggestions_path(document.slug), params: { body: MARKDOWN }, as: :json, headers: agent
    assert_response :created
    assert_equal MARKDOWN, document.suggestions.sole.body
  end

  test "a source too deep can be replaced by one that is not" do
    document = deep_document(MARKDOWN)
    patch api_doc_path(document.slug), params: { content: "fine" }, as: :json, headers: account_agent
    assert_response :success
    get document_page_path(document.slug), headers: inertia
    assert_response :success
  end

  test "a preview that gains wrappers has a page" do
    (380..400).each do |levels|
      get document_page_path(deep_document("#{">" * levels} | a |\n#{">" * levels} |---|").slug), headers: BROWSER
      assert_response :success
    end
  end

  test "an element with many attributes is refused with the same reason" do
    agent = account_agent
    post api_docs_path, params: { content: "<p #{(1..500).map { |i| "a#{i}=1" }.join(" ")}>words</p>", format: "html" }, as: :json, headers: agent
    assert_refused
  end

  test "another argument error is passed on" do
    assert_raises(ArgumentError) { DocumentHtml.within_limits { raise ArgumentError, "something else" } }
  end

  private

  def account_agent(headers = AGENT)
    user = User.create!(name: "Ann", email: "ann@example.com", password: PASSWORD)
    headers.merge("Authorization" => "Bearer #{CliAccessToken.issue!(user:).last}")
  end

  def deep_document(content, **attributes)
    Document.create!(title: "Deep", seed_content: content, **attributes)
  end

  def encode(bytes) = Base64.strict_encode64(bytes)

  def inertia(headers = {})
    BROWSER.merge("X-Inertia" => "true", "X-Inertia-Version" => InertiaController.safe_vite_digest.to_s, **headers)
  end

  def partial(props, component: "documents/show")
    { "X-Inertia-Partial-Component" => component, "X-Inertia-Partial-Data" => props }.compact
  end

  def live_ydoc
    @live_ydoc ||= Y::Doc.new.tap { |ydoc| ydoc.get_text("t") << "live" }
  end

  def live_document(**attributes)
    Document.create!(title: "Live", seed_content: "seed", **attributes).tap do |document|
      YjsPersistence.merge(document, encode(live_ydoc.encode_state_as_update))
      YjsPersistence.fold!(document.reload)
    end
  end

  def assert_refused
    assert_response :unprocessable_entity
    assert_equal DocumentHtml::TooComplex::MESSAGE, response.parsed_body["error"]
  end

  def assert_source_page(content)
    assert_response :success
    assert_select "pre#document-source", 1
    assert_equal content.tr("\0", "\uFFFD"), css_select("pre#document-source").text
    assert_select "#app", 0
  end
end
