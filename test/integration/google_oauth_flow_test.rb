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

  test "a Google identity that cannot be saved ends at the sign-in message" do
    sign_in_with_google(google_auth(email: "not an email"))

    assert_redirected_to login_path
    assert_nil session[:user_id]
    assert_equal "We couldn’t sign you in with Google", inertia_error(:email)
  end

  test "a lock timeout ends at the sign-in message" do
    User.define_singleton_method(:transaction) { |**| raise ActiveRecord::StatementTimeout }

    sign_in_with_google

    assert_redirected_to login_path
    assert_nil session[:user_id]
    assert_equal "We couldn’t sign you in with Google", inertia_error(:email)
  ensure
    User.singleton_class.remove_method(:transaction)
  end

  test "letter case in a Google email does not matter" do
    password_account
    sign_in_with_google(google_auth(email: " KIERAN@Example.com "))

    assert_equal "kieran@example.com", User.find_by!(google_uid: "google-123").account_email
    assert_equal 2, User.with_account_email("kieran@example.com").size
  end

  test "OAuth request phase is post only" do
    get "/auth/google_oauth2"
    assert_response :not_found

    OmniAuth.config.mock_auth[:google_oauth2] = google_auth
    post "/auth/google_oauth2"
    assert_response :redirect
  end

  LONG_RETURN_PATHS = {
    "plain" => "/d/demo?note=#{"a" * 1000}",
    "percent-encoded" => "/d/demo?note=#{"%E2%9C%93" * 111}",
    "ampersands" => "/d/demo?#{"a&" * 140}"
  }.freeze

  LONG_STARTS = {
    "a long Referer" => { headers: { "HTTP_REFERER" => "http://www.example.com/login?x=#{"a" * 4000}" } },
    "an origin in the query" => { query: { origin: "/#{"a" * 4000}" } },
    "an origin in the body" => { params: { origin: "/#{"a" * 4000}" } },
    "another parameter in the query" => { query: { note: "a" * 4000 } },
    "another parameter in the body" => { params: { note: { deep: [ "a" * 4000 ] } } },
    "a state in the query" => { query: { state: "a" * 4000 } },
    "a state in the body" => { params: { state: "a" * 4000 } }
  }.freeze

  { "Google" => false, "the test strategy" => true }.each do |strategy, test_mode|
    LONG_RETURN_PATHS.each do |shape, path|
      test "start Google sign-in from a long return path: #{shape}, #{strategy}" do
        OmniAuth.config.test_mode = test_mode
        login = login_path(return_to: path)
        get login
        assert_equal path, session[:return_to]
        before = session.to_h

        post "/auth/google_oauth2", headers: { "HTTP_REFERER" => "http://www.example.com#{login}" }

        assert_google_started(before)
      end
    end

    LONG_STARTS.each do |shape, input|
      test "start Google sign-in from a long return path: #{shape}, #{strategy}" do
        OmniAuth.config.test_mode = test_mode
        get login_path(return_to: LONG_RETURN_PATHS["plain"])
        before = session.to_h

        post "/auth/google_oauth2#{"?#{input[:query].to_query}" if input[:query]}", **input.slice(:params, :headers)

        assert_google_started(before)
      end
    end
  end

  test "a Google sign-in from a long return path ends at that path" do
    OmniAuth.config.test_mode = false
    path = LONG_RETURN_PATHS["percent-encoded"]
    get login_path(return_to: path)
    post "/auth/google_oauth2", headers: { "HTTP_REFERER" => "http://www.example.com#{login_path(return_to: path)}" }
    query = Rack::Utils.parse_query(URI.parse(response.location).query)

    with_google_responses do
      get "/auth/google_oauth2/callback", params: { code: "code", state: query.fetch("state") }
    end

    assert_redirected_to path
    assert_equal User.find_by!(google_uid: "google-123").id, session[:user_id]
    assert_empty session.to_h.keys.grep(/omniauth/)
  end

  test "a Google sign-in that fails goes back to login with its long return path" do
    OmniAuth.config.test_mode = false
    path = LONG_RETURN_PATHS["plain"]
    get login_path(return_to: path)
    post "/auth/google_oauth2", headers: { "HTTP_REFERER" => "http://www.example.com#{login_path(return_to: path)}" }

    get "/auth/google_oauth2/callback", params: { error: "access_denied", state: session["omniauth.state"] }
    assert_redirected_to "/auth/failure?message=access_denied&strategy=google_oauth2"
    follow_redirect!

    assert_redirected_to login_path(return_to: path)
    assert_nil session[:user_id]
    assert_equal "We couldn’t sign you in with Google", inertia_error(:email)
    follow_redirect!
    assert_response :success
    assert_equal path, session[:return_to]
  end

  private

  # Only Google's own state, of a fixed size, joins what the session held.
  def assert_google_started(before)
    assert_response :redirect
    if OmniAuth.config.test_mode
      assert_equal "/auth/google_oauth2/callback", URI.parse(response.location).path
      assert_equal before, session.to_h
    else
      assert_equal "accounts.google.com", URI.parse(response.location).host
      assert_equal before, session.to_h.except("omniauth.state")
      assert_match(/\A\h{48}\z/, session["omniauth.state"])
      assert_equal session["omniauth.state"],
                   Rack::Utils.parse_query(URI.parse(response.location).query)["state"]
    end
  end

  # Answers in place of Google's token and profile endpoints.
  def with_google_responses
    strategy = OmniAuth::Strategies::GoogleOauth2
    answers = {
      client_get_token: ->(*) { OAuth2::AccessToken.new(client, "token") },
      token_info: ->(*) { { "scope" => "email profile" } },
      raw_info: -> { { "sub" => "google-123", "name" => "Kieran", "email" => "kieran@example.com", "email_verified" => true } }
    }
    originals = answers.keys.index_with { |name| strategy.instance_method(name) }
    silence_warnings { answers.each { |name, answer| strategy.define_method(name, &answer) } }
    yield
  ensure
    silence_warnings { originals&.each { |name, original| strategy.define_method(name, original) } }
    strategy.send(:private, :client_get_token, :token_info)
  end

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
