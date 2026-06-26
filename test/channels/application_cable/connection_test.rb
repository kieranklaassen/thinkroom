require "test_helper"

class ApplicationCable::ConnectionTest < ActionCable::Connection::TestCase
  tests ApplicationCable::Connection

  test "connects readers without an ownership identity" do
    connect

    assert_nil connection.current_user
    assert_nil connection.owner_token
  end

  test "reads the signed guest owner token without identifying the connection by it" do
    cookies.signed[:owner_token] = "guest-secret"

    connect

    assert_equal "guest-secret", connection.owner_token
    refute_includes connection.connection_identifier.to_s, "guest-secret"
  end

  test "reads the signed-in user from the encrypted session cookie" do
    user = User.create!(
      name: "Owner",
      email: "cable-owner@example.com",
      password: "thoughtful-passphrase"
    )
    connect session: { user_id: user.id }

    assert_equal user, connection.current_user
  end
end
