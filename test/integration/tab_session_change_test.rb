require "test_helper"

# Two tabs share cookies; each keeps the token of its own page load. Saves read
# the shared XSRF-TOKEN cookie, so it has to follow the session.
class TabSessionChangeTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers

  setup do
    @original_protection = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    @document = Document.create!(title: "Open tab", content_markdown: "original")
    @user = User.create!(name: "Writer", email: "writer@example.com", password: PASSWORD)
    @page_token = open_document
  end

  teardown { ActionController::Base.allow_forgery_protection = @original_protection }

  test "a tab opened before signing in or out in another tab saves with the shared token" do
    sign_in_elsewhere
    assert_equal 422, save(@page_token)
    assert_equal 204, save(shared_token)

    signed_in_token = shared_token
    delete logout_path, headers: inertia_headers
    assert_response :see_other
    assert_equal 422, save(signed_in_token)
    assert_equal 204, save(shared_token)
  end

  test "a save that began before signing in elsewhere leaves its session and token together" do
    key = Rails.application.config.session_options.fetch(:key)
    earlier_session = cookies[key]
    earlier_token = shared_token
    sign_in_elsewhere

    # The save went out with the earlier session and is answered after the sign-in.
    cookies[key] = earlier_session
    assert_equal 204, save(earlier_token)
    assert_equal 204, save(shared_token)
  end

  test "the shared token adds no access after signing in or out elsewhere" do
    @document.update!(owner_token: "someone-else", owner_name: "Owner", link_access: "view")
    sign_in_elsewhere
    assert_equal 423, save(shared_token)

    @document.update!(user: @user, owner_token: nil)
    assert_equal 204, save(shared_token)

    delete logout_path, headers: inertia_headers
    assert_equal 423, save(shared_token)
  end

  private

  def open_document
    get document_page_path(@document.slug), headers: { "User-Agent" => "Mozilla/5.0" }
    assert_response :success
    css_select('meta[name="csrf-token"]').first["content"]
  end

  def sign_in_elsewhere
    post login_path, params: { email: @user.email, password: PASSWORD }, headers: inertia_headers
    assert_response :see_other
  end

  def inertia_headers
    { "X-Requested-With" => "XMLHttpRequest", "X-XSRF-TOKEN" => shared_token }
  end

  def shared_token = cookies["XSRF-TOKEN"]

  def save(token)
    post document_sync_update_path(@document.slug),
         params: { update: Base64.strict_encode64(Y::Doc.new.encode_state_as_update), generation: @document.content_generation },
         headers: { "Accept" => "application/json", "X-CSRF-Token" => token, "X-Requested-With" => "XMLHttpRequest" }, as: :json
    response.status
  end
end
