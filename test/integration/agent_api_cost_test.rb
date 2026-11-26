require "test_helper"

# How much parsing and querying one agent write or batch accept may do.
class AgentApiCostTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers

  VALID_SKETCH = <<~MD.freeze
    ```excalidraw
    {"id":"flow1","formatVersion":1,"description":"Flow","scene":{"type":"excalidraw","version":2,"elements":[]}}
    ```
  MD
  BROKEN_SKETCH = "```excalidraw\n{broken\n```\n".freeze
  MARKDOWN = "# Plan\n\nKeep **this** text.\n\n#{VALID_SKETCH}\n#{BROKEN_SKETCH}".freeze
  PLAIN_TEXT = "Plan Keep this text. Sketch: Flow".freeze
  BROWSER = { "User-Agent" => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" }.freeze

  setup do
    @owner = User.create!(name: "Owner", email: "owner@example.com", password: PASSWORD)
    _record, token = CliAccessToken.issue!(user: @owner)
    @headers = { "Authorization" => "Bearer #{token}", "X-Agent-Name" => "Scout" }
  end

  def count_calls(klass, name)
    original = klass.method(name)
    calls = 0
    klass.define_singleton_method(name) do |*args, **options, &block|
      calls += 1
      original.call(*args, **options, &block)
    end
    yield
    calls
  ensure
    klass.define_singleton_method(name, original)
  end

  def live_document(format: "markdown", content: "# Old\n\nOld target text.")
    document = Document.create!(title: "Live", user: @owner, content_format: format, seed_content: content)
    document.update!(content_snapshot: content, seed_state: "seeded")
    document.suggestions.create!(author_name: "A", author_kind: "agent", body: "x", replaces: "Keep this text")
    document.suggestions.create!(author_name: "A", author_kind: "agent", body: "x", replaces: "Old target")
    document
  end

  test "creating a Markdown document parses its source once" do
    parses = count_calls(Commonmarker, :to_html) do
      post api_docs_path, params: { content: MARKDOWN }, headers: @headers, as: :json
    end
    assert_response :created
    assert_equal 1, parses
    assert response.parsed_body["plain_text"].start_with?(PLAIN_TEXT)
    assert response.parsed_body["normalized"]
    assert_match(/\AAn excalidraw block/, response.parsed_body["warning"])
  end

  test "replacing a live Markdown document parses the new source once" do
    document = live_document
    parses = count_calls(Commonmarker, :to_html) do
      patch api_doc_path(document.slug), params: { content: MARKDOWN }, headers: @headers, as: :json
    end
    assert_response :ok
    assert_equal 1, parses
    assert response.parsed_body["plain_text"].start_with?(PLAIN_TEXT)
    assert_equal 1, response.parsed_body["auto_rejected_suggestions"]
    assert_equal [ "Keep this text" ], document.suggestions.pending.pluck(:replaces)
  end

  test "replacing a live HTML document renders its text once and looks for no images" do
    document = live_document(format: "html", content: "<h1>Old</h1><p>Old target text.</p>")
    texts = searches = 0
    texts = count_calls(DocumentPlainText, :text) do
      searches = count_calls(ActiveStorage::Blob, :find_signed) do
        patch api_doc_path(document.slug), params: { content: "<p>Keep <b>this</b> text.</p>" }, headers: @headers, as: :json
      end
    end
    assert_response :ok
    assert_equal [ 1, 0 ], [ texts, searches ]
    assert_equal "Keep this text.", response.parsed_body["plain_text"]
  end

  test "a document's text follows its content" do
    document = Document.create!(title: "T", seed_content: "one")
    assert_equal "one", document.plain_text
    document.seed_content = "two"
    assert_equal "two", document.plain_text
    document.seed_content << " three"
    assert_equal "two three", document.plain_text
    document.content_snapshot = ""
    assert_equal "", document.plain_text
    document.use_parsed_source("other", DocumentPlainText.fragment(format: "markdown", content: "other"))
    document.content_snapshot = "four"
    assert_equal "four", document.plain_text
  end

  test "only a source that can name an uploaded image is searched for one" do
    key = "abc"
    plain = %(<p>a &amp; b</p><img src="/elsewhere/x.png">)
    assert_equal 0, count_calls(Nokogiri::HTML5, :fragment) { DocumentAsset.claim_from_html!(document: nil, source: plain) }
    [ "/rails/active_storage/blobs/redirect/#{key}/f.png",
      "&#47;rails/active_storage/blobs/redirect/#{key}/f.png",
      "&sol;rails/active&lowbar;storage/blobs/proxy/#{key}/f.png" ].each do |src|
      found = count_calls(ActiveStorage::Blob, :find_signed) do
        DocumentAsset.claim_from_html!(document: nil, source: %(<img src="#{src}">))
      end
      assert_equal 1, found, src
    end
  end

  test "accepting a batch reads the accepted rows once however many there are" do
    document = Document.create!(title: "Batch", seed_content: "text")
    rows = Array.new(12) { |i| document.suggestions.create!(author_name: "A", author_kind: "agent", body: "b#{i}") }
    rows[3].update!(status: "rejected")

    queries = []
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") { |*, payload| queries << payload[:sql] }
    patch accept_all_document_suggestions_path(document.slug), params: { by: "Kim" }, headers: BROWSER, as: :json
    ActiveSupport::Notifications.unsubscribe(subscriber)

    assert_response :success
    assert_equal 2, queries.count { |sql| sql.match?(/\ASELECT .*FROM "suggestions"/) }
    accepted = response.parsed_body["accepted"]
    assert_equal (rows - [ rows[3] ]).map(&:id), accepted.map { |row| row["id"] }
    assert_equal [ "accepted" ], accepted.map { |row| row["status"] }.uniq
    assert_equal [ "Kim" ], document.suggestions.where(status: "accepted").distinct.pluck(:resolved_by)
    assert_equal "rejected", rows[3].reload.status
  end

  test "a batch accept leaves out a row resolved after the pending read" do
    document = Document.create!(title: "Race", seed_content: "text")
    rows = Array.new(3) { |i| document.suggestions.create!(author_name: "A", author_kind: "agent", body: "b#{i}") }
    raced = false
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
      next if raced || !payload[:sql].match?(/\AUPDATE "suggestions"/)

      raced = true
      Suggestion.where(id: rows[1].id).update_all(status: "rejected")
    end
    assert_equal [ rows[0].id, rows[2].id ], Suggestion.accept_all!(document:, by: "Kim").map(&:id)
    assert_equal "rejected", rows[1].reload.status
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber)
  end

  test "elements carrying reserved attributes are still stripped or kept by trust" do
    source = %(<p><span data-provenance data-kind="ai" data-author="A" data-state="pending">x</span><b data-color="red">y</b></p>)
    assert_equal "<p><span>x</span><b>y</b></p>", HtmlDocumentSanitizer.external(source).content
    kept = HtmlDocumentSanitizer.snapshot(source).content
    assert_includes kept, 'data-kind="ai"'
    assert_not_includes kept, "data-color"
  end
end
