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

    doc = Document.find_by!(slug: body["slug"])
    assert_equal "# From an agent", doc.seed_markdown
    assert_equal "created_document", doc.activities.last.action
    assert_equal "Scout", doc.activities.last.actor_name

    # Agent docs are born unclaimed; the response says so.
    assert_not doc.claimed?
    assert_includes body["note"], "claim"

    get "/d/#{body['slug']}"
    assert_response :success
  end

  test "state read exposes ownership without leaking the token" do
    get "/api/docs/#{@document.slug}", headers: AGENT
    body = response.parsed_body
    assert_equal({ "claimed" => false, "owner_name" => nil }, body["ownership"])

    @document.claim!(token: "tok-owner", name: "Quiet Falcon")

    get "/api/docs/#{@document.slug}", headers: AGENT
    body = response.parsed_body
    assert_equal({ "claimed" => true, "owner_name" => "Quiet Falcon" }, body["ownership"])
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

  test "writes without X-Agent-Name are refused with instructive guidance" do
    post "/api/docs/#{@document.slug}/suggestions", params: { body: "Hi" }, as: :json

    assert_response :unprocessable_entity
    body = response.parsed_body
    assert_includes body["error"], "X-Agent-Name"
    assert_includes body["how_to_participate"], "presence"
    assert_includes body["example"], "curl"
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
end
