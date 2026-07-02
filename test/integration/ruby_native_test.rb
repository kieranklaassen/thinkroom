require "test_helper"

# Ruby Native shell integration: user-agent detection, shared Inertia props,
# layout wiring, the /native/config endpoint, and always-remembered native
# sessions. https://rubynative.com/docs
class RubyNativeTest < ActionDispatch::IntegrationTest
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
    assert_not_nil session_cookie_expiry, "native signup must issue a persistent session cookie"
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

  private

  # The session cookie set by the latest response, or nil if not re-issued.
  def session_cookie_header
    key = Rails.application.config.session_options.fetch(:key)
    header = Array(response.headers["Set-Cookie"]).flat_map { |value| value.split("\n") }
    header.find { |value| value.start_with?("#{key}=") }
  end

  def session_cookie_reissued? = session_cookie_header.present?

  # Expiry of the re-issued session cookie; nil for a browser-session cookie.
  def session_cookie_expiry
    expires = session_cookie_header&.[](/expires=([^;]+)/i, 1)
    expires && Time.zone.parse(expires)
  end
end
