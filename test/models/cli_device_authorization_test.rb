require "test_helper"

class CliDeviceAuthorizationTest < ActiveSupport::TestCase
  setup do
    @user = User.create!(name: "Kieran", email: "cli-device@example.com", password: "thoughtful-passphrase")
  end

  test "start stores a digest and creates a readable expiring code" do
    authorization, raw_device_code = CliDeviceAuthorization.start!

    assert_match(/\A[A-Z2-9]{4}-[A-Z2-9]{4}\z/, authorization.user_code)
    assert_not_equal raw_device_code, authorization.device_code_digest
    assert_in_delta CliDeviceAuthorization::LIFETIME.from_now, authorization.expires_at, 2.seconds
    assert_equal authorization.user_code,
                 CliDeviceAuthorization.normalize_user_code(authorization.user_code.delete("-").downcase)
  end

  test "exchange waits for approval, enforces polling interval, and issues once" do
    authorization, raw_device_code = CliDeviceAuthorization.start!
    now = Time.current

    assert_raises(CliDeviceAuthorization::AuthorizationPending) do
      CliDeviceAuthorization.exchange!(raw_device_code, now:)
    end
    assert_raises(CliDeviceAuthorization::PollingTooQuickly) do
      CliDeviceAuthorization.exchange!(raw_device_code, now: now + 1.second)
    end

    authorization.approve!(@user, now: now + 1.second)
    token, raw_token = CliDeviceAuthorization.exchange!(raw_device_code, now: now + 2.seconds)

    assert_equal @user, token.user
    assert_equal token, CliAccessToken.authenticate(raw_token)
    assert authorization.reload.consumed_at
    assert_raises(CliDeviceAuthorization::AlreadyConsumed) do
      CliDeviceAuthorization.exchange!(raw_device_code, now: now + 4.seconds)
    end
  end

  test "approval rejects expired grants and another account cannot replace approval" do
    authorization, = CliDeviceAuthorization.start!
    other = User.create!(name: "Other", email: "cli-other@example.com", password: "thoughtful-passphrase")

    authorization.approve!(@user)
    assert_raises(CliDeviceAuthorization::AlreadyApproved) { authorization.approve!(other) }

    expired, = CliDeviceAuthorization.start!
    assert_raises(CliDeviceAuthorization::Expired) do
      expired.approve!(@user, now: expired.expires_at + 1.second)
    end
  end

  test "unknown and expired device secrets do not issue tokens" do
    assert_raises(CliDeviceAuthorization::InvalidDeviceCode) do
      CliDeviceAuthorization.exchange!("unknown")
    end

    authorization, raw_device_code = CliDeviceAuthorization.start!
    authorization.approve!(@user)
    assert_raises(CliDeviceAuthorization::Expired) do
      CliDeviceAuthorization.exchange!(raw_device_code, now: authorization.expires_at + 1.second)
    end
  end

  test "starting a grant prunes only authorizations expired for more than a day" do
    stale, = CliDeviceAuthorization.start!
    stale.update_column(:expires_at, 2.days.ago)
    recent, = CliDeviceAuthorization.start!
    recent.update_column(:expires_at, 1.hour.ago)

    CliDeviceAuthorization.start!

    assert_not CliDeviceAuthorization.exists?(stale.id)
    assert CliDeviceAuthorization.exists?(recent.id)
  end
end
