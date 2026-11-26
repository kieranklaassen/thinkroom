require "test_helper"

class GoogleOauthFlowTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers

  setup do
    @original_test_mode = OmniAuth.config.test_mode
    @original_mock = OmniAuth.config.mock_auth[:google_oauth2]
    OmniAuth.config.test_mode = true
    WriteRateLimited::STORE.clear
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

  test "Google sign-in with an email a password account uses creates a separate account" do
    password_user = password_account
    document = Document.create!(title: "Password document", user: password_user, owner_name: password_user.name)
    DocumentPin.pin!(document, user: password_user, token: nil)
    before = password_user.reload.attributes

    sign_in_with_google

    assert_response :see_other
    google_user = User.find_by!(google_uid: "google-123")
    assert_equal google_user.id, session[:user_id]
    assert_not_equal password_user, google_user
    assert_equal before, password_user.reload.attributes
    assert_equal password_user, document.reload.user
    assert_equal [ document.id ], password_user.document_pins.pluck(:document_id)
    assert_empty google_user.documents
    assert_empty google_user.document_pins

    get root_path
    assert_inertia_props do |props|
      props.dig(:viewer, :account, :email) == "kieran@example.com" &&
        props[:yours].none? { |doc| doc[:slug] == document.slug }
    end
  end

  test "the separate Google account is reached again on later sign-ins" do
    password_account
    sign_in_with_google
    google_user = User.find_by!(google_uid: "google-123")
    delete logout_path

    assert_no_difference("User.count") { sign_in_with_google }

    assert_equal google_user.id, session[:user_id]
  end

  test "the password account keeps its session, CLI token, and sign-in" do
    password_user = password_account
    _record, raw_token = CliAccessToken.issue!(user: password_user)
    sign_in_as(password_user)

    open_session { |other| google_sign_in_in(other) }

    get root_path
    assert_equal password_user.id, session[:user_id]
    get api_cli_session_path, headers: { "Authorization" => "Bearer #{raw_token}" }
    assert_equal password_user.id, response.parsed_body.dig("account", "id")

    delete logout_path
    sign_in_as(password_user)
    assert_equal password_user.id, session[:user_id]
  end

  test "documents made after the Google sign-in belong only to the Google account" do
    password_user = password_account
    sign_in_with_google
    google_user = User.find_by!(google_uid: "google-123")

    post documents_path, params: { name: "Kieran" }

    assert_equal google_user, Document.order(:created_at).last.user
    assert_empty password_user.documents
  end

  test "CLI responses show the separate Google account's plain email" do
    password_account
    sign_in_with_google
    google_user = User.find_by!(google_uid: "google-123")
    authorization, device_code = CliDeviceAuthorization.start!

    get cli_authorize_path(code: authorization.user_code)
    assert_inertia_props { |props| props.dig(:account, :email) == "kieran@example.com" }
    post cli_authorize_path(code: authorization.user_code)
    post api_cli_device_authorizations_token_path, params: { device_code: }

    assert_equal({ "id" => google_user.id, "name" => "Kieran", "email" => "kieran@example.com" },
                 response.parsed_body["account"])
    get api_cli_session_path, headers: { "Authorization" => "Bearer #{response.parsed_body["access_token"]}" }
    assert_equal "kieran@example.com", response.parsed_body.dig("account", "email")
  end

  test "an email another Google account uses is refused" do
    User.create!(name: "First", email: "kieran@example.com", google_uid: "google-1")

    assert_no_difference("User.count") { sign_in_with_google }

    assert_redirected_to login_path
    assert_nil session[:user_id]
    assert_equal "We couldn’t sign you in with Google", inertia_error(:email)
  end

  test "an email a separate Google account already uses is refused for another subject" do
    password_account
    sign_in_with_google
    delete logout_path

    assert_no_difference("User.count") { sign_in_with_google(google_auth(uid: "google-456")) }

    assert_nil session[:user_id]
  end

  test "a registration and another callback finishing first do not stop the Google sign-in" do
    create = User.method(:create!)
    meanwhile = [
      ->(email) { create.call(name: "Registered", email:, password: PASSWORD) },
      ->(_email) { create.call(name: "Other tab", email: "kieran@example.com.#{SecureRandom.hex(16)}.google.invalid", google_uid: "google-123") }
    ]
    # The other request's row is already there when the insert runs, so the
    # unique index refuses it, and stays after this transaction rolls back.
    User.define_singleton_method(:create!) do |**attributes|
      step = meanwhile.first or next create.call(**attributes)
      step.call(attributes[:email])
      new(**attributes).save!(validate: false)
    end
    User.define_singleton_method(:transaction) do |**options, &block|
      super(**options, &block)
    rescue ActiveRecord::RecordNotUnique
      meanwhile.shift.call("kieran@example.com")
      raise
    end
    sign_in_with_google

    assert_empty meanwhile
    assert_equal User.find_by!(google_uid: "google-123").id, session[:user_id]
    assert User.find_by!(email: "kieran@example.com").password_account?
  ensure
    User.singleton_class.remove_method(:create!)
    User.singleton_class.remove_method(:transaction)
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

  def password_account
    User.create!(name: "Password owner", email: "kieran@example.com", password: PASSWORD)
  end

  def google_sign_in_in(other)
    OmniAuth.config.mock_auth[:google_oauth2] = google_auth
    other.post "/auth/google_oauth2"
    other.follow_redirect!
    assert_equal User.find_by!(google_uid: "google-123").id, other.session[:user_id]
  end

  def inertia_error(key)
    errors = session[:inertia_errors] || {}
    errors[key] || errors[key.to_s]
  end

  def google_auth(uid: "google-123", name: "Kieran", email: "kieran@example.com", email_verified: true)
    OmniAuth::AuthHash.new(
      provider: "google_oauth2",
      uid:,
      info: { name:, email: },
      extra: {
        id_info: { email_verified: },
        raw_info: { email_verified: email_verified.to_s }
      }
    )
  end
end
