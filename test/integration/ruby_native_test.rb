require "test_helper"

# Ruby Native shell integration: user-agent detection, shared Inertia props,
# layout wiring, the /native/config endpoint, and always-remembered native
# sessions. https://rubynative.com/docs
class RubyNativeTest < ActionDispatch::IntegrationTest
  include SessionCookieAssertions

  # WKWebView UA with the Ruby Native marker appended, as the iOS shell sends.
  NATIVE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) " \
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 " \
    "Safari/604.1 Ruby Native iOS RubyNative/1.0".freeze

  DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " \
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36".freeze

  test "native app requests share nativeApp: true with every Inertia page" do
    get root_path, headers: { "HTTP_USER_AGENT" => NATIVE_UA }

    assert_response :success
    assert_inertia_props do |props|
      props[:nativeApp] == true && props[:nativeForm] == false
    end
  end

  test "browser requests share nativeApp: false" do
    get root_path, headers: { "HTTP_USER_AGENT" => DESKTOP_UA }

    assert_response :success
    assert_inertia_props { |props| props[:nativeApp] == false }
  end

  test "auth pages share nativeForm: true so native back navigation skips them" do
    get login_path, headers: { "HTTP_USER_AGENT" => NATIVE_UA }

    assert_response :success
    assert_inertia_props { |props| props[:nativeForm] == true }
  end

  test "layout carries viewport-fit=cover and the ruby_native stylesheet" do
    get root_path, headers: { "HTTP_USER_AGENT" => DESKTOP_UA }

    assert_response :success
    assert_match(/viewport-fit=cover/, response.body)
    assert_match(/ruby_native.*\.css/, response.body)
  end

  test "/native/config serves the shell configuration without tabs" do
    get "/native/config"

    assert_response :success
    config = response.parsed_body.deep_symbolize_keys
    assert_equal "#b65c3d", config.dig(:appearance, :tint_color)
    assert_equal "light", config.dig(:appearance, :theme)
    assert_equal [ "/auth/google_oauth2" ], config.dig(:auth, :oauth_paths)
    assert_nil config[:tabs], "tab bar must stay hidden (document-centric app)"
    assert_equal "/", config.dig(:app, :entry_path)
  end

  test "native sign-in is always remembered, even without the checkbox" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")

    post login_path,
         params: { email: user.email, password: "thoughtful-passphrase" },
         headers: { "HTTP_USER_AGENT" => NATIVE_UA }

    assert_response :see_other
    assert_equal user.id, session[:user_id]
    expiry = session_cookie_expiry
    assert_not_nil expiry, "native sign-in must issue a persistent session cookie"
    assert_in_delta 30.days.from_now.to_i, expiry.to_i, 1.hour.to_i
  end

  test "native signup is always remembered" do
    post signup_path,
         params: {
           name: "Kieran",
           email: "kieran@example.com",
           password: "thoughtful-passphrase",
           password_confirmation: "thoughtful-passphrase"
         },
         headers: { "HTTP_USER_AGENT" => NATIVE_UA }

    assert_response :see_other
    expiry = session_cookie_expiry
    assert_not_nil expiry, "native signup must issue a persistent session cookie"
    assert_in_delta 30.days.from_now.to_i, expiry.to_i, 1.hour.to_i
  end

  test "native Google OAuth sign-in is remembered via the gem's tracking cookie" do
    # Native OAuth runs in a system-browser sheet (no Ruby Native UA); the
    # gem's OAuthMiddleware marks the flow with a signed cookie that rides
    # the callback request instead.
    original_test_mode = OmniAuth.config.test_mode
    original_mock = OmniAuth.config.mock_auth[:google_oauth2]
    OmniAuth.config.test_mode = true
    OmniAuth.config.mock_auth[:google_oauth2] = OmniAuth::AuthHash.new(
      provider: "google_oauth2",
      uid: "google-123",
      info: { name: "Kieran", email: "kieran@example.com" },
      extra: { id_info: { email_verified: true }, raw_info: { email_verified: "true" } }
    )

    cookies[RubyNative::OAuthMiddleware::COOKIE_NAME] = "signed-scheme-marker"
    post "/auth/google_oauth2", headers: { "HTTP_USER_AGENT" => DESKTOP_UA }
    assert_response :redirect
    follow_redirect!(headers: { "HTTP_USER_AGENT" => DESKTOP_UA })

    assert_response :see_other
    assert_equal User.find_by!(google_uid: "google-123").id, session[:user_id]
    assert_not_nil session_cookie_expiry,
                   "native OAuth sign-in must issue a persistent session cookie"
  ensure
    OmniAuth.config.test_mode = original_test_mode
    OmniAuth.config.mock_auth[:google_oauth2] = original_mock
  end

  test "web Google OAuth sign-in stays a browser-session cookie" do
    original_test_mode = OmniAuth.config.test_mode
    original_mock = OmniAuth.config.mock_auth[:google_oauth2]
    OmniAuth.config.test_mode = true
    OmniAuth.config.mock_auth[:google_oauth2] = OmniAuth::AuthHash.new(
      provider: "google_oauth2",
      uid: "google-456",
      info: { name: "Kieran", email: "kieran@example.com" },
      extra: { id_info: { email_verified: true }, raw_info: { email_verified: "true" } }
    )

    post "/auth/google_oauth2", headers: { "HTTP_USER_AGENT" => DESKTOP_UA }
    assert_response :redirect
    follow_redirect!(headers: { "HTTP_USER_AGENT" => DESKTOP_UA })

    assert_response :see_other
    assert session_cookie_reissued?, "OAuth sign-in must re-issue the session cookie"
    assert_nil session_cookie_expiry, "web OAuth sign-in must stay a browser-session cookie"
  ensure
    OmniAuth.config.test_mode = original_test_mode
    OmniAuth.config.mock_auth[:google_oauth2] = original_mock
  end

  test "browser sign-in without remember_me stays a browser-session cookie" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")

    post login_path,
         params: { email: user.email, password: "thoughtful-passphrase" },
         headers: { "HTTP_USER_AGENT" => DESKTOP_UA }

    assert_response :see_other
    assert session_cookie_reissued?, "login must re-issue the session cookie"
    assert_nil session_cookie_expiry, "web opt-out of remember_me must be preserved"
  end
end
