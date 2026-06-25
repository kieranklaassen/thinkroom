require "test_helper"

class AuthenticationFlowTest < ActionDispatch::IntegrationTest
  setup do
    WriteRateLimited::STORE.clear
  end

  test "registration signs in and promotes this browser's claimed documents" do
    get root_path
    post documents_path, params: { name: "Guest Kieran" }
    document = Document.order(:created_at).last
    original_token = document.owner_token

    post signup_path, params: {
      name: "Kieran",
      email: "KIERAN@example.com",
      password: "thoughtful-passphrase",
      password_confirmation: "thoughtful-passphrase"
    }

    assert_response :see_other
    user = User.find_by!(email: "kieran@example.com")
    assert_equal user.id, session[:user_id]
    assert_equal user, document.reload.user
    assert_nil document.owner_token
    assert_not_equal original_token, cookies[:owner_token]
  end

  test "password login uses a generic failure and promotes claimed documents" do
    user = User.create!(
      name: "Kieran",
      email: "kieran@example.com",
      password: "thoughtful-passphrase"
    )
    get root_path
    post documents_path, params: { name: "Guest" }
    document = Document.order(:created_at).last

    post login_path, params: { email: "KIERAN@example.com", password: "wrong-password" }
    assert_response :redirect
    assert_equal "Invalid email or password", inertia_error(:email)

    post login_path, params: { email: "missing@example.com", password: "wrong-password" }
    assert_response :redirect
    assert_equal "Invalid email or password", inertia_error(:email)

    post login_path, params: { email: "KIERAN@example.com", password: "thoughtful-passphrase" }
    assert_response :see_other
    assert_equal user.id, session[:user_id]
    assert_equal user, document.reload.user
  end

  test "safe return path survives login while external return path is discarded" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")
    document = Document.create!(title: "Return here")

    get login_path(return_to: document_page_path(document.slug))
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }
    assert_redirected_to document_page_path(document.slug)

    delete logout_path
    get login_path(return_to: "https://attacker.example/phish")
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }
    assert_redirected_to root_path
  end

  test "safe return path survives a failed login before success" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")
    document = Document.create!(title: "Return after retry")

    get login_path(return_to: document_page_path(document.slug))
    post login_path, params: { email: user.email, password: "wrong-password" }
    follow_redirect!
    assert_inertia_props { |props| props[:return_to] == document_page_path(document.slug) }

    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }
    assert_redirected_to document_page_path(document.slug)
  end

  test "logout removes account ownership from the guest session" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")
    document = Document.create!(title: "Private to account", user:, owner_name: user.name)
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }

    delete logout_path

    assert_response :see_other
    assert_nil session[:user_id]
    get root_path
    assert_inertia_props do |props|
      props[:viewer][:account].nil? && props[:yours].none? { |doc| doc[:slug] == document.slug }
    end
  end

  test "shared viewer props prefer the authenticated account" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")
    post identity_path, params: { name: "Old guest name" }
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }

    get root_path
    assert_inertia_props do |props|
      viewer = props[:viewer]
      account = viewer[:account]
      viewer[:name] == "Kieran" && viewer[:guest] == false &&
        (account[:id] || account["id"]) == user.id &&
        (account[:name] || account["name"]) == "Kieran" &&
        (account[:email] || account["email"]) == "kieran@example.com"
    end
  end

  test "auth pages expose modes and hide Google when credentials are absent" do
    get login_path
    assert_inertia_component "auth/show"
    assert_inertia_props { |props| props[:mode] == "login" && props[:google_enabled] == false }

    get signup_path
    assert_inertia_component "auth/show"
    assert_inertia_props { |props| props[:mode] == "register" && props[:google_enabled] == false }
  end

  test "password login is rate limited" do
    WriteRateLimited::AUTHENTICATION_BURST_LIMIT.times do
      post login_path, params: { email: "missing@example.com", password: "wrong-password" }
      assert_response :redirect
    end

    post login_path, params: { email: "missing@example.com", password: "wrong-password" }
    assert_response :too_many_requests
  end

  private

  def inertia_error(key)
    errors = session[:inertia_errors] || {}
    errors[key] || errors[key.to_s]
  end
end
