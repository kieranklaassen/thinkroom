require "test_helper"

class CliAuthenticationFlowTest < ActionDispatch::IntegrationTest
  setup do
    WriteRateLimited::STORE.clear
    @user = User.create!(name: "Kieran", email: "cli-flow@example.com", password: "thoughtful-passphrase")
  end

  test "device authorization exposes a browser link and polling status" do
    post "/api/cli/device_authorizations", as: :json

    assert_response :created
    payload = response.parsed_body
    assert payload["device_code"].present?
    assert_match(/\A[A-Z2-9]{4}-[A-Z2-9]{4}\z/, payload["user_code"])
    assert_equal payload["user_code"], Rack::Utils.parse_query(URI(payload["verification_url"]).query)["code"]
    assert_equal CliDeviceAuthorization::POLL_INTERVAL.to_i, payload["interval"]

    post "/api/cli/device_authorizations/token", params: { device_code: payload["device_code"] }, as: :json
    assert_response :too_early
    assert_equal "authorization_pending", response.parsed_body["error"]
  end

  test "browser approval exchanges for an account token exactly once" do
    authorization, raw_device_code = CliDeviceAuthorization.start!
    post login_path, params: { email: @user.email, password: "thoughtful-passphrase" }

    get cli_authorize_path(code: authorization.user_code)
    assert_inertia_component "cli/authorize"
    assert_inertia_props do |props|
      props[:status] == "ready" && props[:user_code] == authorization.user_code &&
        props.dig(:account, :email) == @user.email
    end

    post cli_authorize_path, params: { code: authorization.user_code }
    assert_response :see_other
    assert_equal @user, authorization.reload.user

    post "/api/cli/device_authorizations/token", params: { device_code: raw_device_code }, as: :json
    assert_response :success
    payload = response.parsed_body
    assert payload["access_token"].start_with?(CliAccessToken::TOKEN_PREFIX)
    assert_equal @user.email, payload.dig("account", "email")

    post "/api/cli/device_authorizations/token", params: { device_code: raw_device_code }, as: :json
    assert_response :gone
    assert_equal "access_denied", response.parsed_body["error"]
  end

  test "approval redirects through login and preserves the complete local return path" do
    authorization, = CliDeviceAuthorization.start!

    get cli_authorize_path(code: authorization.user_code)
    assert_response :see_other
    assert_includes response.location, "/login?"

    follow_redirect!
    assert_inertia_component "auth/show"
    assert_inertia_props do |props|
      props[:return_to] == cli_authorize_path(code: authorization.user_code)
    end

    post login_path, params: { email: @user.email, password: "thoughtful-passphrase" }
    assert_redirected_to cli_authorize_path(code: authorization.user_code)
  end

  test "authorization page reports invalid, expired, and completed codes" do
    post login_path, params: { email: @user.email, password: "thoughtful-passphrase" }

    get cli_authorize_path(code: "NOPE-NOPE")
    assert_inertia_props { |props| props[:status] == "invalid" }

    expired, = CliDeviceAuthorization.start!
    expired.update_column(:expires_at, 1.minute.ago)
    get cli_authorize_path(code: expired.user_code)
    assert_inertia_props { |props| props[:status] == "expired" }

    approved, raw_device_code = CliDeviceAuthorization.start!
    approved.approve!(@user)
    get cli_authorize_path(code: approved.user_code)
    assert_inertia_props { |props| props[:status] == "approved" }
    CliDeviceAuthorization.exchange!(raw_device_code)
    get cli_authorize_path(code: approved.user_code)
    assert_inertia_props { |props| props[:status] == "consumed" }
  end

  test "bearer identity, account-owned creation, and revocation work together" do
    token, raw_token = CliAccessToken.issue!(user: @user, name: "Test terminal")
    bearer = { "Authorization" => "Bearer #{raw_token}" }

    get "/api/cli/session", headers: bearer
    assert_response :success
    assert_equal @user.email, response.parsed_body.dig("account", "email")
    assert_equal "Test terminal", response.parsed_body.dig("token", "name")

    post "/api/docs",
         params: { title: "CLI Doc", content: "# From the CLI" },
         headers: bearer.merge("X-Agent-Name" => "Codex"), as: :json
    assert_response :created
    document = Document.find_by!(slug: response.parsed_body["slug"])
    assert_equal @user, document.user
    assert_equal @user.name, document.owner_name
    assert_equal "Codex", document.seed_author_name
    assert_includes response.parsed_body["note"], "your Thinkroom account"

    delete "/api/cli/session", headers: bearer
    assert_response :no_content
    assert token.reload.revoked_at

    get "/api/cli/session", headers: bearer
    assert_response :unauthorized
  end

  test "an explicit invalid bearer token never degrades to anonymous creation" do
    assert_no_difference("Document.count") do
      post "/api/docs",
           params: { title: "Must not exist", content: "# Nope" },
           headers: { "Authorization" => "Bearer trm_invalid", "X-Agent-Name" => "Codex" },
           as: :json
    end

    assert_response :unauthorized
    assert_includes response.parsed_body["next_action"], "thinkroom login"
  end

  test "existing anonymous agent creation remains unclaimed" do
    post "/api/docs",
         params: { title: "Anonymous API", content: "# Shared" },
         headers: { "X-Agent-Name" => "Scout" }, as: :json

    assert_response :created
    document = Document.find_by!(slug: response.parsed_body["slug"])
    assert_not document.claimed?
    assert_includes response.parsed_body["note"], "unclaimed"
  end
end
