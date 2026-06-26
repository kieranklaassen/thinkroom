require "test_helper"

class AgentApiTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  AGENT = { "X-Agent-Name" => "Scout" }.freeze

  setup do
    # Rate-limit counters live in a process-wide store; clear it so per-test
    # write volume can't bleed across tests (mirrors WriteRateLimitTest).
    WriteRateLimited::STORE.clear
    @document = Document.create!(title: "Shared Doc", seed_markdown: "# Hello\n\nA paragraph about provenance.")
  end

  test "agent creates a document from markdown and gets a shareable slug" do
    post "/api/docs",
         params: { title: "Agent Doc", content: "# From an agent" },
         headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert body["slug"].present?
    assert_includes body["share_url"], "/d/#{body['slug']}"
    assert body["api"]["propose_suggestion"]["url"].present?
    assert body["api"]["upload_image"]["url"].present?
    assert_equal 429, body.dig("api", "create_document", "rate_limits", "response_status")
    assert_equal WriteRateLimited::DOCUMENT_CREATION_BURST_LIMIT,
                 body.dig("api", "create_document", "rate_limits", "burst", "requests")
    assert_equal WriteRateLimited::CONTRIBUTION_BURST_LIMIT,
                 body.dig("api", "propose_suggestion", "rate_limits", "burst", "requests")
    assert_equal "markdown", body.dig("content_contract", "content_format")
    assert body.dig("content_contract", "immutable")

    doc = Document.find_by!(slug: body["slug"])
    assert_equal "# From an agent", doc.seed_markdown
    assert_equal "created_document", doc.activities.last.action
    assert_equal "Scout", doc.activities.last.actor_name

    # Agent docs are born unclaimed; the response says so.
    assert_not doc.claimed?
    assert_includes body["note"], "claim"

    # Agent-supplied markdown records agent seed authorship — the seeding
    # client uses it to attribute the seeded text as AI prose.
    assert_equal "agent", doc.seed_author_kind
    assert_equal "Scout", doc.seed_author_name

    get "/d/#{body['slug']}"
    assert_response :success
  end

  test "agent doc without markdown gets DEFAULT_SEED with no seed authorship" do
    post "/api/docs", params: { title: "Empty Doc" }, headers: AGENT, as: :json

    assert_response :created
    doc = Document.find_by!(slug: response.parsed_body["slug"])
    assert_equal Document::DEFAULT_SEED, doc.seed_markdown
    # Placeholder boilerplate must never be claimed as AI prose.
    assert_nil doc.seed_author_kind
    assert_nil doc.seed_author_name
  end

  test "agent creates sanitized HTML and receives generic source fields" do
    post "/api/docs",
         params: {
           title: "HTML Doc",
           format: "html",
           content: '<h1 onclick="bad()">Hello</h1><p><strong>world</strong></p>'
         },
         headers: AGENT,
         as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal "html", body["content_format"]
    assert_equal "Hello world", body["plain_text"]
    assert body["normalized"]
    assert_includes body["warning"], "normalized"
    refute body.key?("markdown")
    refute_match(/onclick/, body["content"])

    doc = Document.find_by!(slug: body["slug"])
    assert_equal "html", doc.content_format
    assert_equal body["content"], doc.seed_content
    assert_equal "agent", doc.seed_author_kind
    contract = body["content_contract"]
    assert_equal 2, contract["version"]
    assert_equal "html", contract["content_format"]
    assert_equal "content", contract["canonical_source_field"]
    assert_equal "plain_text", contract["rendered_text_field"]
    assert_equal ThinkroomSketch::MAX_SCENE_BYTES,
                 contract.dig("sketches", "limits", "scene_max_bytes")
    assert_includes contract.dig("html", "allowed_elements"), "table"
    assert_includes contract.dig("html", "allowed_elements"), "img"
    assert_includes contract.dig("html", "allowed_elements"), "figure"
    assert_includes contract.dig("html", "css", "supported"), "text-align"
    assert_includes contract.dig("html", "css", "removed"), "<style> blocks"
    assert_equal "/api/uploads", URI(contract.dig("html", "images", "upload", "url")).path
    assert_equal ImageUploadPolicy::MAX_INPUT_BYTES,
                 contract.dig("html", "images", "upload", "request", "max_bytes")
    assert_includes contract.dig("html", "images", "removed_sources"), "https:// remote images"
    assert_equal "html", body.dig("api", "create_document", "content_contracts", "html", "content_format")
    assert_equal "markdown", body.dig("api", "create_document", "content_contracts", "markdown", "content_format")
  end

  test "route suffix does not override the document format body field" do
    post "/api/docs.json",
         params: { title: "JSON Markdown", content: "# Body" },
         headers: AGENT,
         as: :json

    assert_response :created
    doc = Document.find_by!(slug: response.parsed_body["slug"])
    assert_equal "markdown", doc.content_format
    assert_equal "# Body", doc.seed_content
  end

  test "HTML state exposes generic fields without markdown aliases" do
    document = Document.create!(
      title: "HTML",
      content_format: "html",
      seed_content: "<h2>Heading</h2><p>Body <em>copy</em>.</p>"
    )

    get "/api/docs/#{document.slug}", headers: AGENT

    assert_response :success
    body = response.parsed_body
    assert_equal "html", body["content_format"]
    assert_equal document.seed_content, body["content"]
    assert_equal "Heading Body copy.", body["plain_text"]
    refute body.key?("markdown")
    refute body.key?("plain_markdown")
    assert_includes body.dig("api", "propose_suggestion", "body", "body"), "HTML"
    assert_equal "html", body.dig("content_contract", "suggestion_body_format")
    assert_includes body.dig("content_contract", "html", "css", "guidance"), "semantic elements"
    assert body["notes"].any? { |note| note.include?("Upload images through api.upload_image") }
  end

  test "HTML suggestion is sanitized and reports normalization" do
    document = Document.create!(
      title: "HTML",
      content_format: "html",
      seed_content: "<p>Hello</p>"
    )

    post "/api/docs/#{document.slug}/suggestions",
         params: { body: '<p onclick="bad()">Better</p>' },
         headers: AGENT,
         as: :json

    assert_response :created
    body = response.parsed_body
    assert body["normalized"]
    assert_includes body["warning"], "normalized"
    assert_equal "<p>Better</p>", document.suggestions.last.body
  end

  test "markdown suggestion with an unrecognized sketch fence reports a warning" do
    bad = sketch_fence({ version: 1, id: "x", scene: { elements: [] } })
    post "/api/docs/#{@document.slug}/suggestions", params: { body: bad }, headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal true, body["normalized"]
    assert_includes body["warning"], "excalidraw block"
  end

  test "markdown suggestion with a valid sketch fence reports clean success" do
    post "/api/docs/#{@document.slug}/suggestions", params: { body: valid_sketch_fence }, headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal false, body["normalized"]
    assert_nil body["warning"]
  end

  test "plain markdown suggestion stays unnormalized" do
    post "/api/docs/#{@document.slug}/suggestions", params: { body: "A tighter intro." }, headers: AGENT, as: :json

    assert_response :created
    assert_equal false, response.parsed_body["normalized"]
    assert_nil response.parsed_body["warning"]
  end

  test "explicit format validates content and rejects unknown formats" do
    assert_no_difference -> { Document.count } do
      post "/api/docs", params: { format: "html" }, headers: AGENT, as: :json
    end
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "content is required"

    assert_no_difference -> { Document.count } do
      post "/api/docs",
           params: { format: "xml", content: "<p>No</p>" },
           headers: AGENT,
           as: :json
    end
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "markdown or html"
  end

  test "doc created without X-Agent-Name records no seed authorship" do
    post "/api/docs", params: { content: "# Anonymous" }, as: :json

    assert_response :created
    doc = Document.find_by!(slug: response.parsed_body["slug"])
    assert_nil doc.seed_author_kind
    assert_nil doc.seed_author_name
  end

  test "oversized agent name is capped at 255 chars in seed authorship" do
    post "/api/docs",
         params: { content: "# Big name" },
         headers: { "X-Agent-Name" => "A" * 300 }, as: :json

    assert_response :created
    doc = Document.find_by!(slug: response.parsed_body["slug"])
    assert_equal "agent", doc.seed_author_kind
    assert_equal 255, doc.seed_author_name.length
  end

  test "state read exposes ownership without leaking the token" do
    get "/api/docs/#{@document.slug}", headers: AGENT
    body = response.parsed_body
    assert_equal(
      { "claimed" => false, "claimable" => true, "owner_name" => nil,
        "link_access" => "edit", "editing_locked" => false,
        "can_write" => true, "can_comment" => true },
      body["ownership"]
    )

    @document.claim!(token: "tok-owner", name: "Quiet Falcon")

    get "/api/docs/#{@document.slug}", headers: AGENT
    body = response.parsed_body
    assert_equal(
      { "claimed" => true, "claimable" => false, "owner_name" => "Quiet Falcon",
        "link_access" => "edit", "editing_locked" => false,
        "can_write" => true, "can_comment" => true },
      body["ownership"]
    )
    refute_includes response.body, "tok-owner"
    refute_includes response.body, "owner_token"
  end

  test "state read returns content, provenance, suggestions, comments" do
    @document.update!(provenance_spans: [ { "kind" => "ai", "state" => "pending", "chars" => 10 } ])
    @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "Pending one")
    @document.comments.create!(
      author_name: "A",
      author_kind: "human",
      body: "Tighten this claim.",
      anchor_text: "A paragraph about provenance."
    )

    get "/api/docs/#{@document.slug}", headers: AGENT

    assert_response :success
    body = response.parsed_body
    assert_includes body["markdown"], "provenance"
    assert_equal 1, body["pending_suggestions"].length
    assert_equal 1, body["open_comments"].length
    assert body["provenance"]["summary"]["ai_pct"].positive?
    assert body["api"].keys.size >= 6

    workflow = body["revision_workflow"]
    assert_equal "claimed_document_comments", workflow["kind"]
    assert_equal %w[read_open_comments propose_targeted_suggestion resolve_addressed_comment],
                 workflow["steps"].pluck("action")
    assert_equal "/api/docs/#{@document.slug}", URI(workflow.dig("steps", 0, "url")).path
    assert_equal "/api/docs/#{@document.slug}/suggestions",
                 URI(workflow.dig("steps", 1, "url")).path
    assert_equal "/api/docs/#{@document.slug}/comments/:id/resolve",
                 URI(workflow.dig("steps", 2, "url")).path
    assert_equal "comment.anchor_text", workflow.dig("steps", 1, "body", "replaces")
    assert_includes workflow.dig("steps", 1, "body", "body"), "replacement"
    assert_includes workflow.dig("steps", 2, "guidance"), "successfully created"
    assert body["notes"].any? { |note| note.include?("Revising a claimed document") }
  end

  test "state omits the comment revision workflow when no comments are open" do
    resolved = @document.comments.create!(
      author_name: "A", author_kind: "human", body: "Already handled"
    )
    resolved.resolve!

    get "/api/docs/#{@document.slug}", headers: AGENT

    assert_response :success
    body = response.parsed_body
    refute body.key?("revision_workflow")
    refute body["notes"].any? { |note| note.include?("Revising a claimed document") }
    assert body.dig("api", "propose_suggestion").present?
    assert body.dig("api", "resolve_comment").present?
  end

  test "state read falls back to seed markdown before any editor session" do
    get "/api/docs/#{@document.slug}", headers: AGENT
    assert_equal @document.seed_markdown, response.parsed_body["markdown"]
  end

  test "cold read reports agent-seeded docs as unreviewed AI with authorship" do
    post "/api/docs", params: { content: "# From an agent" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]

    get "/api/docs/#{slug}", headers: AGENT

    provenance = response.parsed_body["provenance"]
    assert_equal "agent", provenance["seed_author_kind"]
    assert_equal "Scout", provenance["seed_author_name"]
    assert_equal 100, provenance["summary"]["ai_pct"]
    assert_equal 100, provenance["summary"]["unreviewed_pct"]
    assert_empty provenance["spans"]
  end

  test "writes without X-Agent-Name are refused with instructive guidance" do
    post "/api/docs/#{@document.slug}/suggestions", params: { body: "Hi" }, as: :json

    assert_response :unprocessable_entity
    body = response.parsed_body
    assert_includes body["error"], "X-Agent-Name"
    assert_includes body["how_to_participate"], "presence"
    assert_includes body["example"], "curl"
  end

  test "missing identity examples match each write endpoint" do
    {
      "/api/docs/#{@document.slug}/comments" => [ { body: "Hi" }, "/comments" ],
      "/api/docs/#{@document.slug}/presence" => [ { status: "active" }, "/presence" ],
      "/api/docs/#{@document.slug}/events/ack" => [ { last_event_id: 1 }, "/events/ack" ]
    }.each do |path, (params, expected_path)|
      post path, params:, as: :json
      assert_response :unprocessable_entity
      assert_includes response.parsed_body["example"], expected_path
    end
  end

  test "agent suggestion lands pending, attributed, logged, and broadcast" do
    assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 4) do
      # presences (touch) + activities (joined) + activities (suggested) + suggestions
      post "/api/docs/#{@document.slug}/suggestions",
           params: { body: "A better paragraph.", intent: "Improve clarity", anchor_text: "provenance" },
           headers: AGENT, as: :json
    end

    assert_response :created
    suggestion = @document.suggestions.pending.last
    assert_equal "Scout", suggestion.author_name
    assert_equal "agent", suggestion.author_kind
    assert_equal "pending_human_review", response.parsed_body["status"]
    assert_equal %w[joined suggested], @document.activities.order(:id).pluck(:action).last(2)
  end

  test "locked document stays readable but rejects agent contributions" do
    @document.update!(
      owner_token: "owner-token",
      owner_name: "Owner",
      link_access: "view"
    )
    comment = @document.comments.create!(
      author_name: "A", author_kind: "human", body: "Existing"
    )

    get "/api/docs/#{@document.slug}", headers: AGENT
    assert_response :success
    assert_equal true, response.parsed_body.dig("ownership", "editing_locked")
    assert_equal false, response.parsed_body.dig("ownership", "can_write")
    assert response.parsed_body["notes"].any? { |note| note.include?("423") }

    assert_no_difference -> { @document.suggestions.count } do
      post "/api/docs/#{@document.slug}/suggestions",
           params: { body: "Forbidden" }, headers: AGENT, as: :json
    end
    assert_response :locked
    assert_equal true, response.parsed_body["editing_locked"]

    assert_no_difference -> { @document.comments.count } do
      post "/api/docs/#{@document.slug}/comments",
           params: { body: "Forbidden" }, headers: AGENT, as: :json
    end
    assert_response :locked

    post api_doc_resolve_comment_path(slug: @document.slug, id: comment.id),
         headers: AGENT, as: :json
    assert_response :locked
    assert_not comment.reload.resolved_at
  end

  test "comment link permits agent comments but rejects suggestions" do
    @document.update!(
      owner_token: "owner-token",
      owner_name: "Owner",
      link_access: "comment"
    )

    assert_difference -> { @document.comments.count }, 1 do
      post "/api/docs/#{@document.slug}/comments",
           params: { body: "Allowed comment" }, headers: AGENT, as: :json
    end
    assert_response :created

    assert_no_difference -> { @document.suggestions.count } do
      post "/api/docs/#{@document.slug}/suggestions",
           params: { body: "Forbidden suggestion" }, headers: AGENT, as: :json
    end
    assert_response :locked
    assert_equal "comment", response.parsed_body["link_access"]
  end

  test "agent comment is agent-attributed and logged" do
    post "/api/docs/#{@document.slug}/comments",
         params: { body: "Source?", anchor_text: "provenance" },
         headers: AGENT, as: :json

    assert_response :created
    comment = @document.comments.last
    assert_equal %w[Scout agent], [ comment.author_name, comment.author_kind ]
  end

  test "presence announce upserts and re-announce refreshes last_seen_at" do
    post "/api/docs/#{@document.slug}/presence",
         params: { status: "active", location: "provenance" }, headers: AGENT, as: :json
    assert_response :success
    presence = @document.agent_presences.find_by!(agent_name: "Scout")
    first_seen = presence.last_seen_at

    travel 10.seconds do
      post "/api/docs/#{@document.slug}/presence", params: { status: "active" }, headers: AGENT, as: :json
    end
    assert_operator presence.reload.last_seen_at, :>, first_seen
    assert_equal 1, @document.agent_presences.count
  end

  test "presence done removes the agent from the active list" do
    post "/api/docs/#{@document.slug}/presence", params: { status: "active" }, headers: AGENT, as: :json
    post "/api/docs/#{@document.slug}/presence", params: { status: "done" }, headers: AGENT, as: :json
    assert_empty @document.agent_presences.active
  end

  test "event polling returns human activity since last ack" do
    post "/api/docs/#{@document.slug}/presence", params: { status: "active" }, headers: AGENT, as: :json
    Activity.log!(document: @document, actor_name: "Quiet Falcon", actor_kind: "human",
                  action: "accepted_suggestion", detail: "accepted")

    get "/api/docs/#{@document.slug}/events/pending", headers: AGENT
    events = response.parsed_body["events"]
    assert(events.any? { |e| e["action"] == "accepted_suggestion" })
    ack_with = response.parsed_body["ack_with"]

    post "/api/docs/#{@document.slug}/events/ack",
         params: { last_event_id: ack_with }, headers: AGENT, as: :json
    assert_response :no_content

    get "/api/docs/#{@document.slug}/events/pending", headers: AGENT
    assert_empty response.parsed_body["events"]
  end


  test "suggestion without body returns an instructive 422" do
    post "/api/docs/#{@document.slug}/suggestions",
         params: { intent: "no body" }, headers: AGENT, as: :json
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "body is required"
  end

  test "comment without body returns an instructive 422" do
    post "/api/docs/#{@document.slug}/comments",
         params: { anchor_text: "provenance" }, headers: AGENT, as: :json
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "body is required"
  end

  test "event ack without last_event_id returns 422" do
    post "/api/docs/#{@document.slug}/events/ack", params: {}, headers: AGENT, as: :json
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "last_event_id"
  end

  test "presence announce returns an explicit 200" do
    post "/api/docs/#{@document.slug}/presence",
         params: { status: "active" }, headers: AGENT, as: :json
    assert_response :ok
  end

  test "unknown slug returns a clean 404" do
    get "/api/docs/nope", headers: AGENT
    assert_response :not_found
    assert_includes response.parsed_body["error"], "slug"
  end

  test "markdown create with a valid sketch fence reports clean success" do
    post "/api/docs",
         params: { title: "Sketch Doc", content: "Intro\n\n#{valid_sketch_fence}" },
         headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal false, body["normalized"]
    assert_nil body["warning"]
    # The recognized sketch shows as semantic text, not raw scene JSON.
    assert_includes body["plain_text"], "Sketch: Approval flow — Draft"
    refute_includes body["plain_text"], "formatVersion"
  end

  test "markdown create with a below-min sketch height is recognized without warning" do
    # Issue #59: a finite height below MIN_HEIGHT used to render as raw JSON in
    # the editor. Server recognition is height-independent, so the create
    # response stays clean; the editor now clamps the height into range to
    # render it (matching the server preview), rather than breaking silently.
    low = sketch_fence({
      id: "low1", formatVersion: 1, description: "Compact flow", height: 130,
      scene: { type: "excalidraw", version: 2, elements: [ { type: "text", text: "Tight" } ] }
    })
    post "/api/docs", params: { title: "Low Sketch", content: low }, headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal false, body["normalized"], "a below-min height is not a recognition failure"
    assert_nil body["warning"]
    assert_includes body["plain_text"], "Sketch: Compact flow — Tight"
    refute_includes body["plain_text"], "formatVersion"
  end

  test "markdown create with an above-max sketch height is recognized without warning" do
    # The symmetric upper-bound case for issue #59: server recognition is
    # height-independent, so a too-tall height is accepted and the editor
    # clamps it down to MAX_HEIGHT rather than breaking.
    high = sketch_fence({
      id: "high1", formatVersion: 1, description: "Tall flow", height: 5000,
      scene: { type: "excalidraw", version: 2, elements: [ { type: "text", text: "Big" } ] }
    })
    post "/api/docs", params: { title: "High Sketch", content: high }, headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal false, body["normalized"], "an above-max height is not a recognition failure"
    assert_nil body["warning"]
    assert_includes body["plain_text"], "Sketch: Tall flow — Big"
    refute_includes body["plain_text"], "formatVersion"
  end

  test "markdown create with an unrecognized sketch fence is non-silent" do
    # The documented-but-wrong shape from issue #55: top-level `version` and a
    # scene that is not a full excalidraw export. Previously this returned a 201
    # byte-for-byte identical to success.
    bad = sketch_fence({ version: 1, id: "x", scene: { elements: [] } })
    post "/api/docs", params: { title: "Broken Sketch", content: bad },
         headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal true, body["normalized"]
    assert_includes body["warning"], "excalidraw block"
    assert_includes body["warning"], "code block"
    # The recognition signal the issue calls out: raw scene JSON in plain_text.
    assert_includes body["plain_text"], %("version")
    refute_includes body["plain_text"], "Sketch:"
    # The broadened contract documents this outcome.
    assert_includes body.dig("content_contract", "normalization", "meaning"), "excalidraw"
  end

  test "markdown create pluralizes the warning for multiple bad fences" do
    bad = sketch_fence({ version: 1, scene: {} })
    post "/api/docs",
         params: { title: "Two Broken", content: "#{bad}\n\nBetween\n\n#{bad}" },
         headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal true, body["normalized"]
    assert_includes body["warning"], "2 excalidraw blocks"
  end

  test "plain markdown create stays unnormalized" do
    post "/api/docs", params: { content: "# Just text, no sketch" }, headers: AGENT, as: :json

    assert_response :created
    assert_equal false, response.parsed_body["normalized"]
    assert_nil response.parsed_body["warning"]
  end

  test "a malformed sketch fence body returns 201 with a warning, not a 500" do
    # Valid JSON but not a Hash, and an unencodable number: these used to raise
    # while building plain_text, 500ing the request after the doc was persisted.
    [ "[1,2,3]", "42", %({"formatVersion":1,"scene":{"type":"excalidraw","version":2,"elements":[],"x":1e309}}) ].each do |body|
      assert_difference -> { Document.count }, 1 do
        post "/api/docs", params: { content: "```excalidraw\n#{body}\n```" }, headers: AGENT, as: :json
      end
      assert_response :created
      body_json = response.parsed_body
      assert body_json["slug"].present?, "agent must receive a slug, not an orphaned doc"
      assert_equal true, body_json["normalized"]
      assert_includes body_json["warning"], "excalidraw block"
    end
  end

  test "an unrecognized sketch via the content field also reports the warning" do
    bad = sketch_fence({ version: 1, id: "x", scene: { elements: [] } })
    post "/api/docs", params: { format: "markdown", content: bad }, headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal "markdown", body["content_format"]
    assert_equal true, body["normalized"]
    assert_includes body["warning"], "excalidraw block"
  end

  # --- PATCH /api/docs/:slug (seed-stage update) ---

  test "agent updates a seed-stage document in place keeping its slug" do
    post "/api/docs", params: { title: "Draft", content: "# First cut" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]
    share_url = response.parsed_body["share_url"]

    patch "/api/docs/#{slug}",
          params: { title: "Revised", content: "# Second cut\n\nBetter now." },
          headers: AGENT, as: :json

    assert_response :ok
    body = response.parsed_body
    assert_equal slug, body["slug"], "slug must stay stable — the whole point of update"
    assert_equal share_url, body["share_url"]
    assert_equal "Revised", body["title"]
    assert_includes body["content"], "Second cut"

    doc = Document.find_by!(slug: slug)
    assert_equal "Revised", doc.title
    assert_includes doc.current_content, "Second cut"
    assert_equal "updated_document", doc.activities.last.action
    assert_equal "Scout", doc.activities.last.actor_name
  end

  test "update on a collaborative document returns 409 with a route to suggestions" do
    @document.update!(yjs_state: "binary-crdt-state")
    @document.comments.create!(
      author_name: "Editor",
      author_kind: "human",
      body: "Make this more concrete.",
      anchor_text: "A paragraph about provenance."
    )

    patch "/api/docs/#{@document.slug}",
          params: { content: "# Trying to overwrite" },
          headers: AGENT, as: :json

    assert_response :conflict
    body = response.parsed_body
    assert_includes body["error"], "no longer an unclaimed draft"
    assert_equal "/api/docs/#{@document.slug}", URI(body["read_state"]).path
    assert_includes body["propose_suggestion"], "/api/docs/#{@document.slug}/suggestions"
    assert_equal "/api/docs/#{@document.slug}/comments/:id/resolve",
                 URI(body["resolve_comment"]).path
    assert_equal AgentGuide.revision_workflow(@document, request.base_url).as_json,
                 body["revision_workflow"]
    assert_includes body["how_to_revise"], "open_comments"
    assert_includes body["how_to_revise"], "anchor_text"
    assert_includes body["how_to_revise"], "replaces"
    assert_match(/resolve/i, body["how_to_revise"])

    @document.reload
    assert_equal "# Hello\n\nA paragraph about provenance.", @document.seed_markdown,
                 "seed must be untouched when the editor has taken over"
  end

  test "update conflict does not require comment resolution when there are no open comments" do
    @document.update!(yjs_state: "binary-crdt-state")

    patch "/api/docs/#{@document.slug}",
          params: { content: "# Trying to overwrite" },
          headers: AGENT, as: :json

    assert_response :conflict
    assert_includes response.parsed_body["how_to_revise"], "If open_comments is empty"
  end

  test "update returns 409 once an editor snapshot shadows the seed even if yjs_state is blank" do
    # A markdown snapshot can persist content_snapshot with no yjs_state. The
    # seed is then no longer what readers see, so a seed overwrite would 200
    # while changing nothing — block it instead of silently no-opping.
    @document.update!(content_snapshot: "# Snapshot the editor pushed")

    patch "/api/docs/#{@document.slug}",
          params: { content: "# would be invisible" },
          headers: AGENT, as: :json

    assert_response :conflict
    @document.reload
    assert_equal "# Hello\n\nA paragraph about provenance.", @document.seed_markdown
  end

  test "update returns 409 once a human has claimed the document" do
    @document.update!(owner_token: SecureRandom.hex(8), owner_name: "Owner")

    patch "/api/docs/#{@document.slug}",
          params: { content: "# not yours to overwrite" },
          headers: AGENT, as: :json

    assert_response :conflict
    @document.reload
    assert_equal "# Hello\n\nA paragraph about provenance.", @document.seed_markdown,
                 "a claimed document's seed must not be overwritable through the agent API"
  end

  test "title-only update leaves content and seed authorship untouched" do
    post "/api/docs", params: { title: "Draft", content: "# Body stays" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]
    doc_before = Document.find_by!(slug: slug)

    patch "/api/docs/#{slug}", params: { title: "Renamed" }, headers: AGENT, as: :json

    assert_response :ok
    doc = Document.find_by!(slug: slug)
    assert_equal "Renamed", doc.title
    assert_equal doc_before.seed_content, doc.current_content
    assert_equal "agent", doc.seed_author_kind
    assert_equal "Scout", doc.seed_author_name
  end

  test "content-only update leaves the title untouched" do
    post "/api/docs", params: { title: "Keep Me", content: "# Old" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]

    patch "/api/docs/#{slug}", params: { content: "# New" }, headers: AGENT, as: :json

    assert_response :ok
    doc = Document.find_by!(slug: slug)
    assert_equal "Keep Me", doc.title
    assert_includes doc.current_content, "New"
  end

  test "update rejects a format that differs from the immutable stored format" do
    post "/api/docs", params: { content: "# Markdown doc" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]

    patch "/api/docs/#{slug}",
          params: { format: "html", content: "<h1>nope</h1>" },
          headers: AGENT, as: :json

    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "immutable"
    assert_equal "# Markdown doc", Document.find_by!(slug: slug).seed_content
  end

  test "update accepts a format that matches the stored format" do
    post "/api/docs", params: { content: "# Markdown doc" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]

    patch "/api/docs/#{slug}",
          params: { format: "markdown", content: "# Still markdown" },
          headers: AGENT, as: :json

    assert_response :ok
    assert_includes Document.find_by!(slug: slug).current_content, "Still markdown"
  end

  test "clean HTML update reports no normalization" do
    post "/api/docs", params: { format: "html", content: "<h1>Clean</h1>" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]

    patch "/api/docs/#{slug}", params: { content: "<h1>Still clean</h1><p>Body.</p>" }, headers: AGENT, as: :json

    assert_response :ok
    body = response.parsed_body
    assert_equal false, body["normalized"]
    assert_nil body["warning"]
    assert_includes body["content"], "Still clean"
  end

  test "update with neither title nor content is rejected" do
    patch "/api/docs/#{@document.slug}", params: {}, headers: AGENT, as: :json

    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "title or content"
  end

  test "update rejects content larger than the byte cap" do
    post "/api/docs", params: { content: "# small" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]

    patch "/api/docs/#{slug}",
          params: { content: "x" * (Document::MAX_CONTENT_BYTES + 1) },
          headers: AGENT, as: :json

    assert_response :content_too_large
    assert_equal Document::MAX_CONTENT_BYTES, response.parsed_body["max_bytes"]
  end

  test "update reports HTML normalization the same way create does" do
    post "/api/docs",
         params: { format: "html", content: "<h1>Clean</h1>" },
         headers: AGENT, as: :json
    slug = response.parsed_body["slug"]

    patch "/api/docs/#{slug}",
          params: { content: '<h1 onclick="bad()">Hi</h1><script>evil()</script>' },
          headers: AGENT, as: :json

    assert_response :ok
    body = response.parsed_body
    assert body["normalized"]
    assert_includes body["warning"], "normalized"
    refute_match(/onclick|script/, body["content"])
  end

  test "update with an unrecognized markdown sketch fence reports a warning" do
    post "/api/docs", params: { content: "# fine" }, headers: AGENT, as: :json
    slug = response.parsed_body["slug"]
    bad = sketch_fence({ version: 1, id: "x", scene: { elements: [] } })

    patch "/api/docs/#{slug}", params: { content: bad }, headers: AGENT, as: :json

    assert_response :ok
    body = response.parsed_body
    assert_equal true, body["normalized"]
    assert_includes body["warning"], "excalidraw block"
  end

  test "update re-attributes seed authorship to the updating agent" do
    post "/api/docs", params: { content: "# v1" }, headers: { "X-Agent-Name" => "Author" }, as: :json
    slug = response.parsed_body["slug"]

    patch "/api/docs/#{slug}",
          params: { content: "# v2" },
          headers: { "X-Agent-Name" => "Editor" }, as: :json

    assert_response :ok
    doc = Document.find_by!(slug: slug)
    assert_equal "agent", doc.seed_author_kind
    assert_equal "Editor", doc.seed_author_name
    assert_equal "updated_document", doc.activities.last.action
    assert_equal "Editor", doc.activities.last.actor_name
  end

  test "anonymous content update preserves the original seed authorship" do
    post "/api/docs", params: { content: "# v1" }, headers: { "X-Agent-Name" => "Author" }, as: :json
    slug = response.parsed_body["slug"]

    patch "/api/docs/#{slug}", params: { content: "# v2" }, as: :json

    assert_response :ok
    doc = Document.find_by!(slug: slug)
    assert_equal "agent", doc.seed_author_kind
    assert_equal "Author", doc.seed_author_name
  end

  test "create response advertises the update endpoint to agents" do
    post "/api/docs", params: { content: "# hi" }, headers: AGENT, as: :json

    assert_response :created
    update = response.parsed_body.dig("api", "update_document")
    assert_equal "PATCH", update["method"]
    assert_equal 409, update["conflict_status"]
    assert_includes update["url"], "/api/docs/#{response.parsed_body['slug']}"
    assert_includes update["purpose"], "seed-stage"
  end

  test "state payload advertises the update endpoint and explains it in notes" do
    get "/api/docs/#{@document.slug}", headers: AGENT, as: :json

    assert_response :success
    assert_equal "PATCH", response.parsed_body.dig("api", "update_document", "method")
    assert response.parsed_body["notes"].any? { |n| n.include?("PATCH /api/docs/:slug") }
  end

  test "plain-text share guide documents updating a created document" do
    get "/d/#{@document.slug}", headers: { "User-Agent" => "curl/8.6.0" }

    assert_response :success
    assert_equal "text/plain", response.media_type
    assert_includes response.body, "Revise a document you created"
    assert_includes response.body, "-X PATCH"
  end

  test "update of an unknown slug returns a clean 404" do
    patch "/api/docs/does-not-exist", params: { content: "# x" }, headers: AGENT, as: :json

    assert_response :not_found
    assert_includes response.parsed_body["error"], "No document with that slug."
  end

  test "update writes are rate limited per source IP" do
    headers = AGENT.merge("REMOTE_ADDR" => "192.0.2.243")
    post "/api/docs", params: { content: "# seed" }, headers:, as: :json
    slug = response.parsed_body["slug"]

    WriteRateLimited::CONTRIBUTION_BURST_LIMIT.times do
      patch "/api/docs/#{slug}", params: { content: "# rev" }, headers:, as: :json
      assert_response :ok
    end

    patch "/api/docs/#{slug}", params: { content: "# rev" }, headers:, as: :json

    assert_response :too_many_requests
    assert_includes response.parsed_body["error"], "rate limit"
  end

  private

  def valid_sketch_fence
    sketch_fence({
      id: "flow1", formatVersion: 1, description: "Approval flow", height: 260,
      scene: { type: "excalidraw", version: 2, elements: [ { type: "text", text: "Draft" } ] }
    })
  end

  def sketch_fence(payload)
    "```excalidraw\n#{JSON.generate(payload)}\n```"
  end
end
