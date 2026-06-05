require "test_helper"

class OwnershipFlowTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    @document = Document.create!(title: "Claimable")
  end

  # Visiting any page mints the owner_token cookie; this helper establishes
  # a browser identity for the test session.
  def establish_identity
    get root_path
    assert_response :success
  end

  test "claim via POST sets ownership and redirects 303" do
    establish_identity

    post claim_document_path(@document.slug), params: { name: "Quiet Falcon" }

    assert_response :see_other
    @document.reload
    assert @document.claimed?
    assert_equal "Quiet Falcon", @document.owner_name
  end

  test "losing claimer gets a redirect, not an error status, and the first owner survives" do
    establish_identity
    Document.where(id: @document.id).update_all(
      owner_token: "someone-else", owner_name: "Winner", claimed_at: Time.current
    )

    post claim_document_path(@document.slug), params: { name: "Loser" }

    assert_response :see_other
    assert_equal "Winner", @document.reload.owner_name
  end

  test "claiming the demo doc redirects back with the unclaimable message" do
    Document.create!(title: "Demo", slug: "demo")
    establish_identity

    post claim_document_path("demo"), params: { name: "Grabby" }

    assert_response :see_other
    assert_not Document.find_by(slug: "demo").claimed?
  end

  test "GET show never sets ownership" do
    get document_page_path(@document.slug), headers: browser
    assert_response :success
    assert_not @document.reload.claimed?
  end

  test "claim broadcasts ownership and activities events" do
    establish_identity

    assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 2) do
      post claim_document_path(@document.slug), params: { name: "Quiet Falcon" }
    end
  end

  test "claim logs an activity with the claimer's name" do
    establish_identity

    assert_difference -> { @document.activities.count }, 1 do
      post claim_document_path(@document.slug), params: { name: "Quiet Falcon" }
    end
    activity = @document.activities.last
    assert_equal "claimed_document", activity.action
    assert_includes activity.detail, "Quiet Falcon"
  end

  test "delete by owner destroys doc and dependents and redirects home" do
    establish_identity
    post claim_document_path(@document.slug), params: { name: "Owner" }
    @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "text")
    @document.comments.create!(author_name: "Someone", body: "note")

    delete destroy_document_path(@document.slug)

    assert_redirected_to root_path
    assert_nil Document.find_by(slug: @document.slug)
    assert_equal 0, Suggestion.where(document_id: @document.id).count
    assert_equal 0, Comment.where(document_id: @document.id).count
  end

  test "delete by non-owner is refused and the doc survives" do
    Document.where(id: @document.id).update_all(
      owner_token: "someone-else", owner_name: "Owner", claimed_at: Time.current
    )
    establish_identity

    delete destroy_document_path(@document.slug)

    assert_response :see_other
    assert_not_nil Document.find_by(slug: @document.slug)
  end

  test "delete of unclaimed doc is refused — claim first" do
    establish_identity

    delete destroy_document_path(@document.slug)

    assert_response :see_other
    assert_not_nil Document.find_by(slug: @document.slug)
  end

  test "delete of an already-deleted slug redirects home idempotently" do
    establish_identity

    delete destroy_document_path("gone-already")

    assert_redirected_to root_path
  end

  test "delete broadcasts document_deleted before destroying" do
    establish_identity
    post claim_document_path(@document.slug), params: { name: "Owner" }

    # claim already broadcast 2; the delete adds exactly 1 document_deleted
    assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 1) do
      delete destroy_document_path(@document.slug)
    end
  end

  test "UI create assigns ownership to the creator in the same insert" do
    establish_identity

    assert_difference -> { Document.count }, 1 do
      post documents_path, params: { name: "Maker" }
    end

    doc = Document.order(:created_at).last
    assert doc.claimed?
    assert_equal "Maker", doc.owner_name
    # No claim activity for auto-claims — the doc was never up for grabs.
    assert_equal 0, doc.activities.where(action: "claimed_document").count
  end

  test "API create leaves the doc unclaimed" do
    post "/api/docs",
         params: { title: "Agent Doc" }.to_json,
         headers: { "Content-Type" => "application/json", "X-Agent-Name" => "Scout" }

    assert_response :created
    doc = Document.find_by(slug: JSON.parse(response.body)["slug"])
    assert_not doc.claimed?
    assert doc.claimable?
  end

  test "show includes ownership prop with yours true only for the owner's session" do
    establish_identity
    post claim_document_path(@document.slug), params: { name: "Owner" }

    get document_page_path(@document.slug), headers: browser
    assert_response :success
    assert_inertia_props do |props|
      own = props[:ownership]
      own[:claimed] == true && own[:claimable] == false &&
        own[:owner_name] == "Owner" && own[:yours] == true
    end

    # A different browser (fresh session, fresh cookie jar) sees yours: false.
    reset!
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props do |props|
      props[:ownership][:claimed] == true && props[:ownership][:yours] == false
    end
  end

  test "ownership prop marks the demo doc unclaimable" do
    Document.create!(title: "Demo", slug: "demo")

    get document_page_path("demo"), headers: browser
    assert_inertia_props do |props|
      own = props[:ownership]
      own[:claimed] == false && own[:claimable] == false && own[:yours] == false
    end
  end

  test "ownership prop never contains the owner token" do
    establish_identity
    post claim_document_path(@document.slug), params: { name: "Owner" }

    get document_page_path(@document.slug), headers: browser
    refute_match(/owner_token/, response.body)
  end

  # --- CSRF: the claim/delete surface must be forgery-protected ---
  # test env disables forgery protection globally, so these re-enable it
  # locally; without that, a forged POST would "succeed" and prove nothing.

  # show_exceptions = :rescuable in test, so InvalidAuthenticityToken renders
  # as 422 rather than raising — assert on the response, not the exception.
  test "forged claim POST without CSRF token is rejected when protection is active" do
    with_forgery_protection do
      get document_page_path(@document.slug), headers: browser # mint cookies, but discard the token

      post claim_document_path(@document.slug), params: { name: "Forger" }

      assert_response :unprocessable_entity
      assert_not @document.reload.claimed?
    end
  end

  test "forged claim POST with JSON content type and no CSRF token is rejected" do
    with_forgery_protection do
      get document_page_path(@document.slug), headers: browser

      post claim_document_path(@document.slug),
           params: { name: "Forger" }.to_json,
           headers: { "Content-Type" => "application/json" }

      assert_response :unprocessable_entity
      assert_not @document.reload.claimed?
    end
  end

  private

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end

  def with_forgery_protection
    original = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    yield
  ensure
    ActionController::Base.allow_forgery_protection = original
  end
end
