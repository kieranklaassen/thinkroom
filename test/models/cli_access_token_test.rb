require "test_helper"

class CliAccessTokenTest < ActiveSupport::TestCase
  setup do
    @user = User.create!(name: "Kieran", email: "cli-token@example.com", password: "thoughtful-passphrase")
  end

  test "issue stores only a digest and authenticate returns the user token" do
    record, raw_token = CliAccessToken.issue!(user: @user, name: "Laptop")

    assert raw_token.start_with?(CliAccessToken::TOKEN_PREFIX)
    assert_not_equal raw_token, record.token_digest
    assert_equal 64, record.token_digest.length
    assert_equal record, CliAccessToken.authenticate(raw_token)
    assert_equal @user, record.user
    assert record.reload.last_used_at
  end

  test "invalid and revoked tokens do not authenticate" do
    record, raw_token = CliAccessToken.issue!(user: @user)

    assert_nil CliAccessToken.authenticate("not-a-token")
    record.revoke!
    assert_nil CliAccessToken.authenticate(raw_token)
  end
end
