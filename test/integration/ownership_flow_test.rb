require "test_helper"

class OwnershipFlowTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    WriteRateLimited::STORE.clear
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

  test "delete broadcasts a document_deleted event after a successful destroy" do
    establish_identity
    post claim_document_path(@document.slug), params: { name: "Owner" }

    assert_broadcast_on(DocumentMetaChannel.broadcasting_for(@document), event: "document_deleted") do
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

  test "signed-in UI create assigns account ownership without an owner token" do
    user = create_and_sign_in_user

    post documents_path

    assert_response :see_other
    doc = Document.order(:created_at).last
    assert_equal user, doc.user
    assert_nil doc.owner_token
    assert_equal user.name, doc.owner_name
  end

  test "signed-in claim assigns account ownership using the account name" do
    user = create_and_sign_in_user

    post claim_document_path(@document.slug), params: { name: "Spoofed name" }

    assert_response :see_other
    assert_equal user, @document.reload.user
    assert_nil @document.owner_token
    assert_equal user.name, @document.owner_name
  end

  test "account-owned document is yours after signing in from a fresh browser" do
    user = create_and_sign_in_user
    document = Document.create!(title: "Across browsers", user:, owner_name: user.name)

    reset!
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }
    get root_path

    assert_inertia_props do |props|
      props[:yours].any? { |doc| doc[:slug] == document.slug }
    end
  end

  test "account owner can delete from another signed-in browser" do
    user = create_and_sign_in_user
    document = Document.create!(title: "Delete elsewhere", user:, owner_name: user.name)

    reset!
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }
    delete destroy_document_path(document.slug)

    assert_redirected_to root_path
    assert_not Document.exists?(document.id)
  end

  test "old guest token cannot delete a document after account promotion" do
    establish_identity
    post claim_document_path(@document.slug), params: { name: "Guest" }
    old_cookie = cookies[:owner_token]
    post signup_path, params: {
      name: "Account owner",
      email: "owner@example.com",
      password: "thoughtful-passphrase",
      password_confirmation: "thoughtful-passphrase"
    }
    assert_nil @document.reload.owner_token

    reset!
    cookies[:owner_token] = old_cookie
    delete destroy_document_path(@document.slug)

    assert_response :see_other
    assert Document.exists?(@document.id)
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

  # --- home page: Your docs + deduped recents ---

  test "index lists docs claimed by this session under yours, newest first" do
    establish_identity
    older = Document.create!(title: "Older", created_at: 2.hours.ago)
    newer = Document.create!(title: "Newer")
    post claim_document_path(older.slug), params: { name: "Me" }
    post claim_document_path(newer.slug), params: { name: "Me" }

    get root_path
    assert_inertia_props do |props|
      props[:yours].map { |d| d[:title] } == [ "Newer", "Older" ]
    end
  end

  test "index excludes docs owned by another token from yours" do
    Document.where(id: @document.id).update_all(
      owner_token: "someone-else", owner_name: "Other", claimed_at: Time.current
    )

    get root_path
    assert_inertia_props do |props|
      props[:yours].empty?
    end
  end

  test "a doc both owned and recently viewed appears only under yours" do
    establish_identity
    get document_page_path(@document.slug), headers: browser # adds to recents
    post claim_document_path(@document.slug), params: { name: "Me" }

    get root_path
    assert_inertia_props do |props|
      props[:yours].any? { |d| d[:slug] == @document.slug } &&
        props[:recent].none? { |d| d[:slug] == @document.slug }
    end
  end

  test "unowned recently viewed docs still appear under recent" do
    establish_identity
    get document_page_path(@document.slug), headers: browser

    get root_path
    assert_inertia_props do |props|
      props[:recent].any? { |d| d[:slug] == @document.slug }
    end
  end

  test "yours caps at 50 newest docs" do
    establish_identity
    oldest = Document.create!(title: "doc-oldest", created_at: 60.minutes.ago)
    post claim_document_path(oldest.slug), params: { name: "Me" }
    51.times do |i|
      doc = Document.create!(title: "doc-#{i}", created_at: (50 - i).minutes.ago)
      post claim_document_path(doc.slug), params: { name: "Me" }
    end

    get root_path
    assert_inertia_props do |props|
      props[:yours].length == 50 && props[:yours].none? { |d| d[:title] == "doc-oldest" }
    end
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

  def create_and_sign_in_user
    user = User.create!(
      name: "Account owner",
      email: "owner@example.com",
      password: "thoughtful-passphrase"
    )
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }
    assert_response :see_other
    user
  end

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
