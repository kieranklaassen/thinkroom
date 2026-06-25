require "test_helper"

class AgentApiTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  AGENT = { "X-Agent-Name" => "Scout" }.freeze

  setup do
    @document = Document.create!(title: "Shared Doc", seed_markdown: "# Hello\n\nA paragraph about provenance.")
  end

  test "agent creates a document from markdown and gets a shareable slug" do
    post "/api/docs",
         params: { title: "Agent Doc", markdown: "# From an agent" },
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

  test "explicit format validates content and legacy field compatibility" do
    assert_no_difference -> { Document.count } do
      post "/api/docs", params: { format: "html" }, headers: AGENT, as: :json
    end
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "content is required"

    assert_no_difference -> { Document.count } do
      post "/api/docs",
           params: { format: "html", markdown: "# Wrong field" },
           headers: AGENT,
           as: :json
    end
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "markdown field"

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
    post "/api/docs", params: { markdown: "# Anonymous" }, as: :json

    assert_response :created
    doc = Document.find_by!(slug: response.parsed_body["slug"])
    assert_nil doc.seed_author_kind
    assert_nil doc.seed_author_name
  end

  test "oversized agent name is capped at 255 chars in seed authorship" do
    post "/api/docs",
         params: { markdown: "# Big name" },
         headers: { "X-Agent-Name" => "A" * 300 }, as: :json

    assert_response :created
    doc = Document.find_by!(slug: response.parsed_body["slug"])
    assert_equal "agent", doc.seed_author_kind
    assert_equal 255, doc.seed_author_name.length
  end

  test "state read exposes ownership without leaking the token" do
    get "/api/docs/#{@document.slug}", headers: AGENT
    body = response.parsed_body
    assert_equal({ "claimed" => false, "claimable" => true, "owner_name" => nil }, body["ownership"])

    @document.claim!(token: "tok-owner", name: "Quiet Falcon")

    get "/api/docs/#{@document.slug}", headers: AGENT
    body = response.parsed_body
    assert_equal({ "claimed" => true, "claimable" => false, "owner_name" => "Quiet Falcon" }, body["ownership"])
    refute_includes response.body, "tok-owner"
    refute_includes response.body, "owner_token"
  end

  test "state read returns content, provenance, suggestions, comments" do
    @document.update!(provenance_spans: [ { "kind" => "ai", "state" => "pending", "chars" => 10 } ])
    @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "Pending one")
    @document.comments.create!(author_name: "A", author_kind: "human", body: "Open one")

    get "/api/docs/#{@document.slug}", headers: AGENT

    assert_response :success
    body = response.parsed_body
    assert_includes body["markdown"], "provenance"
    assert_equal 1, body["pending_suggestions"].length
    assert_equal 1, body["open_comments"].length
    assert body["provenance"]["summary"]["ai_pct"].positive?
    assert body["api"].keys.size >= 6
  end

  test "state read falls back to seed markdown before any editor session" do
    get "/api/docs/#{@document.slug}", headers: AGENT
    assert_equal @document.seed_markdown, response.parsed_body["markdown"]
  end

  test "cold read reports agent-seeded docs as unreviewed AI with authorship" do
    post "/api/docs", params: { markdown: "# From an agent" }, headers: AGENT, as: :json
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
         params: { title: "Sketch Doc", markdown: "Intro\n\n#{valid_sketch_fence}" },
         headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal false, body["normalized"]
    assert_nil body["warning"]
    # The recognized sketch shows as semantic text, not raw scene JSON.
    assert_includes body["plain_text"], "Sketch: Approval flow — Draft"
    refute_includes body["plain_text"], "formatVersion"
  end

  test "markdown create with an unrecognized sketch fence is non-silent" do
    # The documented-but-wrong shape from issue #55: top-level `version` and a
    # scene that is not a full excalidraw export. Previously this returned a 201
    # byte-for-byte identical to success.
    bad = sketch_fence({ version: 1, id: "x", scene: { elements: [] } })
    post "/api/docs", params: { title: "Broken Sketch", markdown: bad },
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
         params: { title: "Two Broken", markdown: "#{bad}\n\nBetween\n\n#{bad}" },
         headers: AGENT, as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal true, body["normalized"]
    assert_includes body["warning"], "2 excalidraw blocks"
  end

  test "plain markdown create stays unnormalized" do
    post "/api/docs", params: { markdown: "# Just text, no sketch" }, headers: AGENT, as: :json

    assert_response :created
    assert_equal false, response.parsed_body["normalized"]
    assert_nil response.parsed_body["warning"]
  end

  test "a malformed sketch fence body returns 201 with a warning, not a 500" do
    # Valid JSON but not a Hash, and an unencodable number: these used to raise
    # while building plain_text, 500ing the request after the doc was persisted.
    [ "[1,2,3]", "42", %({"formatVersion":1,"scene":{"type":"excalidraw","version":2,"elements":[],"x":1e309}}) ].each do |body|
      assert_difference -> { Document.count }, 1 do
        post "/api/docs", params: { markdown: "```excalidraw\n#{body}\n```" }, headers: AGENT, as: :json
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
