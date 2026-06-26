require "test_helper"

class GoogleOauthFlowTest < ActionDispatch::IntegrationTest
  setup do
    @original_test_mode = OmniAuth.config.test_mode
    @original_mock = OmniAuth.config.mock_auth[:google_oauth2]
    OmniAuth.config.test_mode = true
  end

  teardown do
    OmniAuth.config.test_mode = @original_test_mode
    OmniAuth.config.mock_auth[:google_oauth2] = @original_mock
  end

  test "verified Google callback creates and signs in a Google-only user" do
    get root_path
    post documents_path, params: { name: "Guest" }
    document = Document.order(:created_at).last

    sign_in_with_google

    assert_response :see_other
    user = User.find_by!(google_uid: "google-123")
    assert user.google_account?
    assert_not user.password_account?
    assert_equal user.id, session[:user_id]
    assert_equal user, document.reload.user
  end

  test "existing Google subject signs into the same account" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", google_uid: "google-123")

    sign_in_with_google(google_auth(name: "Changed"))

    assert_equal user.id, session[:user_id]
    assert_equal 1, User.where(google_uid: "google-123").count
    assert_equal "Kieran", user.reload.name
  end

  test "Google never auto-links a colliding password email" do
    password_user = User.create!(
      name: "Password owner",
      email: "kieran@example.com",
      password: "thoughtful-passphrase"
    )

    sign_in_with_google

    assert_redirected_to login_path
    assert_nil session[:user_id]
    assert_nil password_user.reload.google_uid
    assert_equal "Use your email and password for this account", inertia_error(:email)
  end

  test "Google rejects unverified or incomplete identity payloads" do
    sign_in_with_google(google_auth(email_verified: false))
    assert_redirected_to login_path
    assert_equal 0, User.count

    sign_in_with_google(google_auth(email: nil))
    assert_redirected_to login_path
    assert_equal 0, User.count
  end

  test "OAuth request phase is post only" do
    get "/auth/google_oauth2"
    assert_response :not_found

    OmniAuth.config.mock_auth[:google_oauth2] = google_auth
    post "/auth/google_oauth2"
    assert_response :redirect
  end

  private

  def sign_in_with_google(auth = google_auth)
    OmniAuth.config.mock_auth[:google_oauth2] = auth
    post "/auth/google_oauth2"
    assert_response :redirect
    follow_redirect!
  end

  def inertia_error(key)
    errors = session[:inertia_errors] || {}
    errors[key] || errors[key.to_s]
  end

  def google_auth(name: "Kieran", email: "kieran@example.com", email_verified: true)
    OmniAuth::AuthHash.new(
      provider: "google_oauth2",
      uid: "google-123",
      info: { name:, email: },
      extra: {
        id_info: { email_verified: },
        raw_info: { email_verified: email_verified.to_s }
      }
    )
  end
end
