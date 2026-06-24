require "test_helper"

# One URL, two audiences: the share link must teach an agent how to
# participate without any prior knowledge.
class AgentDiscoveryTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Discoverable", seed_markdown: "# Hi")
  end

  test "browsers get the editor HTML with the agent guide embedded invisibly" do
    get "/d/#{@document.slug}", headers: {
      "User-Agent" => "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Accept" => "text/html"
    }

    assert_response :success
    assert_includes response.body, "documents/show"          # Inertia page
    assert_includes response.body, 'id="agent-guide"'        # hidden guidance
    assert_includes response.body, "X-Agent-Name"
    assert_includes response.body, "/api/docs/#{@document.slug}/suggestions"
  end

  test "curl-like fetch of the share URL surfaces the plain-text guide" do
    get "/d/#{@document.slug}", headers: { "User-Agent" => "curl/8.6.0" }

    assert_response :success
    assert_equal "text/plain", response.media_type
    assert_includes response.body, "agent guide"
    assert_includes response.body, "Thinkroom share link"
    refute_includes response.body, "Pruf share link"
    assert_includes response.body, "X-Agent-Name"
    assert_includes response.body, "/api/docs/#{@document.slug}"
  end

  test "JSON accept on the share URL returns machine-readable state + endpoints" do
    get "/d/#{@document.slug}", headers: {
      "Accept" => "application/json",
      "User-Agent" => "Mozilla/5.0"
    }

    assert_response :success
    body = response.parsed_body
    assert_equal @document.slug, body["slug"]
    assert body["api"]["announce_presence"]["url"].present?
    assert_equal "/api/uploads", URI(body.dig("api", "upload_image", "url")).path
    assert_equal "multipart/form-data", body.dig("api", "upload_image", "request", "content_type")
    assert_equal 201, body.dig("api", "upload_image", "success_status")
    assert_equal "required", body.dig("api", "propose_suggestion", "headers", "X-Agent-Name")
    assert_equal Document::MAX_CONTENT_BYTES,
                 body.dig("api", "create_document", "limits", "content_max_bytes")
    assert_equal "html",
                 body.dig("api", "create_document", "content_contracts", "html", "content_format")
    assert body["notes"].any? { |n| n.include?("X-Agent-Name") }
    assert body["notes"].any? { |n| n.include?("creation permits no header") }
    assert body["notes"].any? { |n| n.include?("content is canonical Markdown source") }
    assert body["notes"].any? { |n| n.include?("unique quote from plain_text") }
    assert_equal "markdown", body.dig("content_contract", "suggestion_body_format")
    refute body.dig("content_contract").key?("html")
  end

  test "explicit ?format=txt works regardless of user agent" do
    get "/d/#{@document.slug}?format=txt", headers: { "User-Agent" => "Mozilla/5.0" }
    assert_equal "text/plain", response.media_type
    assert_includes response.body, "Announce yourself"
  end

  test "explicit ?format=json returns machine-readable state" do
    get "/d/#{@document.slug}?format=json", headers: { "User-Agent" => "Mozilla/5.0" }

    assert_response :success
    assert_equal "application/json", response.media_type
    assert_equal @document.slug, response.parsed_body["slug"]
    assert_equal "markdown", response.parsed_body["content_format"]
  end

  test "text guide marks claiming browser-only and explains deletion 404 semantics" do
    get "/d/#{@document.slug}", headers: { "User-Agent" => "curl/8.6.0" }

    assert_response :success
    assert_includes response.body, "browser-only"
    assert_includes response.body, "cannot claim"
    assert_includes response.body, "treat a 404 on a previously-working slug as"
  end

  test "JSON state on the share URL includes ownership" do
    @document.claim!(token: "tok-owner", name: "Quiet Falcon")

    get "/d/#{@document.slug}", headers: {
      "Accept" => "application/json",
      "User-Agent" => "Mozilla/5.0"
    }

    body = response.parsed_body
    assert_equal({ "claimed" => true, "claimable" => false, "owner_name" => "Quiet Falcon" }, body["ownership"])
    assert body["notes"].any? { |n| n.include?("cannot claim") }
    refute_includes response.body, "tok-owner"
  end

  test "HTML text guide uses readable native HTML in its suggestion example" do
    document = Document.create!(
      title: "HTML guide",
      content_format: "html",
      seed_content: "<p>Hello</p>"
    )

    get "/d/#{document.slug}?format=txt", headers: { "User-Agent" => "Mozilla/5.0" }

    assert_response :success
    assert_includes response.body, '"body":"<p>Your proposed HTML.</p>"'
    assert_includes response.body, "canonical source in \"content\""
    assert_includes response.body, "ProseMirror/Yjs is"
    assert_includes response.body, "do not send editor JSON or CRDT data"
    assert_includes response.body, "missing or ambiguous replacement stays"
    assert_includes response.body, "creation permits no header"
    assert_includes response.body, "## HTML, CSS, and images"
    assert_includes response.body, "/api/uploads"
    assert_includes response.body, '-F "file=@figure.png"'
    assert_includes response.body, '<img src="RETURNED_SRC" alt="Descriptive text">'
    assert_includes response.body, "only text-align left, center, or"
    assert_includes response.body, "<style> blocks"
    assert_includes response.body, "safely re-encoded"
    assert_includes response.body, "within one hour"
    assert_includes response.body, "Read the created document state"
    assert_includes response.body, "Remote, protocol-relative, data:"
    refute_includes response.body, "\\u003c"
  end
end
