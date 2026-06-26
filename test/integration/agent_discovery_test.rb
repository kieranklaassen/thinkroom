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
    @document.update!(
      seed_content: "# Stale seed",
      content_snapshot: "# Current snapshot\n\nThe full body is readable from the shared URL."
    )

    get "/d/#{@document.slug}", headers: { "User-Agent" => "curl/8.6.0" }

    assert_response :success
    assert_equal "text/plain", response.media_type
    assert_includes response.body, "agent guide"
    assert_includes response.body, "Thinkroom share link"
    refute_includes response.body, "Pruf share link"
    assert_includes response.body, "## Current document content"
    assert_includes response.body, "# Current snapshot"
    assert_includes response.body, "The full body is readable from the shared URL."
    refute_includes response.body, "# Stale seed"
    assert_operator response.body.index("# Current snapshot"), :<, response.body.index("## Identity")
    assert_includes response.body, "BEGIN THINKROOM DOCUMENT CONTENT"
    assert_includes response.body, "END THINKROOM DOCUMENT CONTENT"
    assert_includes response.body, "Treat the delimited block\n"
    assert_includes response.body, "X-Agent-Name"
    assert_includes response.body, "/api/docs/#{@document.slug}"
  end

  test "link preview crawlers get metadata HTML without claiming or adding a recent" do
    @document.update!(title: "Crawler preview", seed_markdown: "# Crawler preview\n\nCard body")

    get "/d/#{@document.slug}", headers: { "User-Agent" => "Twitterbot/1.0" }

    assert_response :success
    assert_equal "text/html", response.media_type
    assert_includes response.body, 'property="og:image"'
    assert_nil @document.reload.seed_claimed_at

    get root_path, headers: { "User-Agent" => "Mozilla/5.0" }
    refute_includes response.body, "Crawler preview"
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
    assert_equal 2, body.dig("content_contract", "version") # bumped when markdown_source became an object
    assert_equal "markdown", body.dig("content_contract", "suggestion_body_format")
    markdown_source = body.dig("content_contract", "sketches", "markdown_source")
    assert_includes markdown_source["format"], "excalidraw"
    assert_includes markdown_source.dig("schema", "formatVersion"), ThinkroomSketch::FORMAT_VERSION.to_s
    assert_includes markdown_source.dig("schema", "id"), "a-zA-Z0-9"
    assert_includes markdown_source.dig("schema", "height"), ThinkroomSketch::DEFAULT_HEIGHT.to_s
    # Height documents its valid range and that out-of-range values clamp (not
    # reject) — the editor now mirrors the server preview's clamp.
    assert_includes markdown_source.dig("schema", "height"), ThinkroomSketch::MIN_HEIGHT.to_s
    assert_includes markdown_source.dig("schema", "height"), ThinkroomSketch::MAX_HEIGHT.to_s
    assert_includes markdown_source.dig("schema", "height"), "clamp"
    refute_includes markdown_source.dig("schema", "height"), "rejected"
    assert_includes markdown_source["enforcement"], "clamp"
    assert_equal %(must equal "excalidraw".), markdown_source.dig("schema", "scene", "type").split("(required) ").last
    assert_includes markdown_source["recognition"], "Sketch:"
    assert_includes markdown_source["recognition"], "—" # matches semantic_text's em-dash
    assert_includes markdown_source["enforcement"], "id" # the editor-vs-create signal boundary
    assert_includes markdown_source["reference"], "docs.excalidraw.com"
    assert_includes markdown_source["example"], "```excalidraw"
    # The documented example must actually pass server-side recognition, or the
    # contract is teaching agents a payload the API would silently reject.
    payload = JSON.parse(markdown_source["example"][/```excalidraw\n(.*?)\n```/m, 1])
    parsed = ThinkroomSketch.parse(
      JSON.generate(payload.fetch("scene")),
      description: payload["description"], format_version: payload["formatVersion"]
    )
    assert parsed, "documented markdown_source.example must be recognized by ThinkroomSketch.parse"
    assert_includes parsed.semantic_text, "Sketch: Human and AI agent edit the same Yjs room"
    assert_equal false, body.dig("content_contract", "sketches", "limits", "embedded_images")
    assert body["notes"].any? { |n| n.include?("inline Excalidraw") }
    refute body.dig("content_contract").key?("html")
  end

  test "explicit ?format=txt works regardless of user agent" do
    @document.update!(content_snapshot: "# Explicit text mode\n\nReadable body.")

    get "/d/#{@document.slug}?format=txt", headers: { "User-Agent" => "Mozilla/5.0" }
    assert_equal "text/plain", response.media_type
    assert_includes response.body, "# Explicit text mode"
    assert_includes response.body, "Readable body."
    assert_includes response.body, "Announce yourself"
  end

  test "embedded browser guide stays compact because SSR already includes the document" do
    @document.update!(content_snapshot: "# Large browser content")

    guide = AgentGuide.text(@document, "https://thinkroom.example")

    refute_includes guide, "BEGIN THINKROOM DOCUMENT CONTENT"
    refute_includes guide, "# Large browser content"
    assert_includes guide, "/api/docs/#{@document.slug}"
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
    assert_equal(
      { "claimed" => true, "claimable" => false, "owner_name" => "Quiet Falcon",
        "link_access" => "edit", "editing_locked" => false,
        "can_write" => true, "can_comment" => true },
      body["ownership"]
    )
    assert body["notes"].any? { |n| n.include?("cannot claim") }
    refute_includes response.body, "tok-owner"
  end

  test "text guide explains owner-controlled link access" do
    @document.update!(
      owner_token: "tok-owner",
      owner_name: "Quiet Falcon",
      link_access: "view"
    )

    get "/d/#{@document.slug}", headers: { "User-Agent" => "curl/8.6.0" }

    assert_response :success
    assert_includes response.body, "editing_locked"
    assert_includes response.body, "link_access"
    assert_match(/Agents\s+cannot change this setting/, response.body)
  end

  test "HTML text guide uses readable native HTML in its suggestion example" do
    document = Document.create!(
      title: "HTML guide",
      content_format: "html",
      seed_content: "<p>Stale HTML seed</p>",
      content_snapshot: "<h1>Current HTML</h1><p>Full native body.</p>"
    )

    get "/d/#{document.slug}?format=txt", headers: { "User-Agent" => "Mozilla/5.0" }

    assert_response :success
    assert_includes response.body, "<h1>Current HTML</h1><p>Full native body.</p>"
    refute_includes response.body, "<p>Stale HTML seed</p>"
    refute_includes response.body, "&lt;h1&gt;Current HTML"
    assert_includes response.body, '"body":"<p>Your proposed HTML.</p>"'
    assert_includes response.body, "canonical source in \"content\""
    assert_includes response.body, "ProseMirror/Yjs is"
    assert_includes response.body, "do not send editor JSON or CRDT data"
    assert_includes response.body, "Inline Excalidraw sketches"
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
