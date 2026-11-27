require "test_helper"

class ReturnPathTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers

  REFUSED = [
    "//example.com", "//example.com/page", "///example.com", "////example.com", "//user@example.com/page",
    "/d//page", "/.//example.com", "/..//example.com", "/%2e%2e//example.com",
    "/\\example.com", "\\\\example.com/page", "/\\/example.com", "/d/page?q=\\",
    "/%2Fexample.com", "/%2f/example.com", "/%252Fexample.com", "/%25252fexample.com",
    "/%5Cexample.com", "/%5c%5cexample.com", "/%255Cexample.com", "/./%2Fexample.com",
    "/\t/example.com", "/\n/example.com", "/\r/example.com", "\t//example.com", "/d/page\n", " /d/page",
    "/%09/example.com", "/%0A/example.com", "/%0d%0aexample.com", "/%00", "/%7F", "/%2509/example.com", "/%25%32%66example.com", "/d/page?q=\n1", "/d/page?q=\u0001", "/d/page#\t", "//@/page",
    "https://example.com/page", "HTTPS://example.com", "https:/page", "https:page", "http://user@example.com/page",
    "http://www.example.com/d/page", "javascript:void(0)", "data:text/html,page",
    "user@example.com/page", "@example.com", "example.com/page", "d/page", "?q=1", "#top", "/d/%zz",
    "/d/%#{"25" * 600}41", "/d/#{"a" * 1022}", "/?#{"&" * 171}", "mailto:x", "mailto:", "mailto:x?y"
  ].freeze

  ACCEPTED = [
    "/", "/d/page", "/d/page/edit", "/d/page?view=1&next=%2Fd%2Fother", "/d/page?q=%5C%0A#part-2",
    "/d/page#part%2Ftwo", "/d/page?url=https://example.com//page", "/d/page%20one", "/d/page/", "/?q=1", "/d/100%25", "/d/%FF", "/d/#{"a" * 1021}", "/?#{"&" * 170}",
    "/cli/authorize?code=ABCD-EFGH", "/cli/authorize?code=ABCD-EFGH#confirm"
  ].freeze

  ENTRY_POINTS = { login: :log_in, signup: :sign_up, google: :continue_with_google }.freeze

  setup do
    @user = User.create!(name: "Reader", email: "reader@example.com", password: PASSWORD)
    @original_test_mode = OmniAuth.config.test_mode
    @original_mock = OmniAuth.config.mock_auth[:google_oauth2]
    OmniAuth.config.test_mode = true
  end

  teardown do
    OmniAuth.config.test_mode = @original_test_mode
    OmniAuth.config.mock_auth[:google_oauth2] = @original_mock
  end

  REFUSED.each do |value|
    ENTRY_POINTS.each do |name, sign_in|
      test "return path accepts local paths only: #{name} given #{value.inspect}" do
        get page_for(name), params: { return_to: value }
        assert_response :success
        assert_nil session[:return_to]
        assert_nil page_return_to

        send(sign_in)
        assert_redirected_to root_path
      end

      test "return path accepts local paths only: #{name} with #{value.inspect} in the session" do
        put_return_path_in_session(value)
        send(sign_in)
        assert_redirected_to root_path
      end
    end

    test "return path accepts local paths only: unsuccessful sign-in with #{value.inspect} in the session" do
      put_return_path_in_session(value)

      post login_path, params: { email: @user.email, password: "not-it" }
      assert_redirected_to login_path
      put_return_path_in_session(value)
      post signup_path, params: { name: "", email: "" }
      assert_redirected_to signup_path
      put_return_path_in_session(value)
      continue_with_google(uid: nil)
      assert_redirected_to login_path
    end
  end

  ACCEPTED.each do |value|
    ENTRY_POINTS.each do |name, sign_in|
      test "return path keeps local paths: #{name} given #{value.inspect}" do
        get page_for(name), params: { return_to: value }
        assert_equal value, session[:return_to]
        assert_equal value, page_return_to

        send(sign_in)
        assert_redirected_to "http://www.example.com#{value}"
      end
    end

    test "return path keeps local paths: unsuccessful sign-in given #{value.inspect}" do
      get login_path, params: { return_to: value }
      post login_path, params: { email: @user.email, password: "not-it" }
      assert_redirected_to "#{login_path}?#{Rack::Utils.build_query(return_to: value)}"
      follow_redirect!
      assert_equal value, page_return_to
    end
  end

  ENTRY_POINTS.each do |name, sign_in|
    test "return path keeps local paths: #{name} with a path in the session" do
      put_return_path_in_session("/d/page?view=1#part-2")
      send(sign_in)
      assert_redirected_to "http://www.example.com/d/page?view=1#part-2"
    end
  end

  test "return path given a long query continues to the default page" do
    get login_path, params: { return_to: "/?#{"&" * 600}" }
    assert_response :success
    assert_nil session[:return_to]
  end

  test "return path accepts text only" do
    [ { return_to: [ "/d/page" ] }, { return_to: { path: "/d/page" } } ].each do |params|
      get login_path, params: params
      assert_response :success
      assert_nil session[:return_to]
    end
  end

  test "return path keeps the cli page and its query" do
    path = "/cli/authorize?code=ABCD-EFGH&note=%2Fone%2F%2Ftwo"
    get path
    follow_redirect!
    assert_equal path, page_return_to

    sign_in_as(@user)
    assert_redirected_to "http://www.example.com#{path}"
  end

  private

  def page_for(name) = name == :signup ? signup_path : login_path

  def log_in = sign_in_as(@user)

  def sign_up
    post signup_path, params: {
      name: "Writer", email: "writer@example.com", password: PASSWORD, password_confirmation: PASSWORD
    }
  end

  def continue_with_google(uid: "google-return-path")
    OmniAuth.config.mock_auth[:google_oauth2] = OmniAuth::AuthHash.new(
      provider: "google_oauth2",
      uid:,
      info: { name: "Writer", email: "writer@example.com" },
      extra: { id_info: { email_verified: true } }
    )
    post "/auth/google_oauth2"
    follow_redirect!
  end

  def page_return_to = inertia.props.with_indifferent_access[:return_to]

  # Stands in for a session saved before the current rule.
  def put_return_path_in_session(value)
    get login_path
    key = Rails.application.config.session_options[:key]
    jar = ActionDispatch::Cookies::CookieJar.build(request, {})
    jar.encrypted[key] = { value: session.to_hash.merge("return_to" => value) }
    cookies[key] = jar[key]
  end
end
