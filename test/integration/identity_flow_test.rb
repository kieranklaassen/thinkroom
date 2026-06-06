require "test_helper"

class IdentityFlowTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Doc")
  end

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end

  def viewer_props
    props = nil
    assert_inertia_props do |p|
      props = p
      true
    end
    props[:viewer]
  end

  test "setting a name serves viewer.name on subsequent pages" do
    post identity_path, params: { name: "Kieran" }
    assert_response :see_other

    get root_path
    viewer = viewer_props
    assert_equal "Kieran", viewer[:name]
    assert_equal false, viewer[:guest]
  end

  test "viewer is delivered on a partial reload" do
    post identity_path, params: { name: "Kieran" }
    get root_path # establish the page + version

    get root_path, headers: {
      "X-Inertia" => "true",
      "X-Inertia-Version" => InertiaController.safe_vite_digest.to_s,
      "X-Inertia-Partial-Component" => "documents/index",
      "X-Inertia-Partial-Data" => "viewer"
    }
    assert_response :success
    props = response.parsed_body.fetch("props")
    assert_equal "Kieran", props.dig("viewer", "name")
  end

  test "forged identity POST without CSRF token is rejected when protection is active" do
    original = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    begin
      get root_path # mint cookies, discard the token

      post identity_path, params: { name: "Forger" }

      assert_response :unprocessable_entity
      get root_path
      assert viewer_props[:guest]
    ensure
      ActionController::Base.allow_forgery_protection = original
    end
  end

  test "non-string name params clear rather than stringify" do
    post identity_path, params: { name: "Kieran" }
    post identity_path, params: { name: { x: "1" } }

    get root_path
    assert viewer_props[:guest]
  end

  test "name persists across requests in the same session" do
    post identity_path, params: { name: "Kieran" }

    get root_path
    assert_equal "Kieran", viewer_props[:name]
    get document_page_path(@document.slug), headers: browser
    assert_equal "Kieran", viewer_props[:name]
  end

  test "no name set means guest mode" do
    get root_path
    viewer = viewer_props
    assert_nil viewer[:name]
    assert viewer[:guest]
  end

  test "blank name clears back to guest — session key gone, not Anonymous" do
    post identity_path, params: { name: "Kieran" }
    post identity_path, params: { name: "   " }

    get root_path
    viewer = viewer_props
    assert_nil viewer[:name]
    assert viewer[:guest]
    refute_equal "Anonymous", viewer[:name]
  end

  test "names are stripped and capped at 255" do
    post identity_path, params: { name: "  Kieran  " }
    get root_path
    assert_equal "Kieran", viewer_props[:name]

    post identity_path, params: { name: "x" * 400 }
    get root_path
    assert_equal 255, viewer_props[:name].length
  end

  test "HTML in the name arrives as an inert JSON string" do
    post identity_path, params: { name: "<script>alert(1)</script>" }
    get root_path
    assert_equal "<script>alert(1)</script>", viewer_props[:name]
  end

  test "GET requests never set or change the name" do
    get root_path
    get document_page_path(@document.slug), headers: browser
    get root_path
    assert viewer_props[:guest]
  end

  # --- session name wins on every attribution write ---

  test "create stamps the session name over the posted name" do
    post identity_path, params: { name: "Kieran" }

    post documents_path, params: { name: "Stale Guest" }
    assert_equal "Kieran", Document.order(:created_at).last.owner_name
  end

  test "claim stamps the session name over the posted name" do
    post identity_path, params: { name: "Kieran" }

    post claim_document_path(@document.slug), params: { name: "Stale Guest" }
    @document.reload
    assert_equal "Kieran", @document.owner_name
    assert_includes @document.activities.last.detail, "Kieran"
  end

  test "comments carry the session name over the posted author_name" do
    post identity_path, params: { name: "Kieran" }

    post document_comments_path(@document.slug), params: { body: "hi", author_name: "Stale Guest" }
    assert_equal "Kieran", @document.comments.last.author_name
  end

  test "comment resolution logs the session name" do
    comment = @document.comments.create!(author_name: "Someone", body: "note")
    post identity_path, params: { name: "Kieran" }

    patch resolve_comment_path(comment), params: { by: "Stale Guest" }
    assert_equal "Kieran", @document.activities.last.actor_name
  end

  test "suggestion accept and reject resolve with the session name" do
    post identity_path, params: { name: "Kieran" }

    accepted = @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "a")
    patch accept_suggestion_path(accepted), params: { by: "Stale Guest" }
    assert_equal "Kieran", accepted.reload.resolved_by
    assert_equal "Kieran", @document.activities.last.actor_name

    rejected = @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "b")
    patch reject_suggestion_path(rejected), params: { by: "Stale Guest" }
    assert_equal "Kieran", rejected.reload.resolved_by
  end

  test "guests keep the client-posted fallback everywhere" do
    post documents_path, params: { name: "Quiet Falcon" }
    assert_equal "Quiet Falcon", Document.order(:created_at).last.owner_name

    post document_comments_path(@document.slug), params: { body: "hi", author_name: "Quiet Falcon" }
    assert_equal "Quiet Falcon", @document.comments.last.author_name

    suggestion = @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "a")
    patch accept_suggestion_path(suggestion), params: { by: "Quiet Falcon" }
    assert_equal "Quiet Falcon", suggestion.reload.resolved_by
  end
end
