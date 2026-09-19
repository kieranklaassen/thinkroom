require "test_helper"

class AdminToolsTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers

  # Flipper's test help gives every test a fresh in-memory adapter (as in
  # Cora), so the boot-time defaults are registered here explicitly.
  setup { Flipper.load_flag_defaults! }

  test "Flipper UI is 404 for visitors and non-admin accounts, and renders for admins" do
    get "/admin/flipper"
    assert_response :not_found

    plain = User.create!(name: "Plain", email: "plain@example.com", password: PASSWORD)
    sign_in_as(plain)
    get "/admin/flipper"
    assert_response :not_found
    get "/admin/flipper/features"
    assert_response :not_found

    delete logout_path
    admin = User.create!(name: "Admin", email: "admin@example.com", password: PASSWORD, admin: true)
    sign_in_as(admin)
    get "/admin/flipper/features"
    assert_response :ok
    assert_match(/compound_writing/, response.body)
  end

  test "the compound_writing flag is registered from the defaults and disabled" do
    assert Flipper.exist?(:compound_writing)
    assert_not Flipper.enabled?(:compound_writing)
    assert_equal :off, Flipper.feature(:compound_writing).state
    assert_equal "Compound writing reviewers in Comment mode (packs of Jev lenses)", Flipper.flag_defaults.dig("compound_writing", "purpose")
  end

  test "available_to? follows the flag: per actor, through the admins group, or fully enabled" do
    user = User.create!(name: "U", email: "u@example.com", password: PASSWORD)
    assert_not CompoundWriting.available_to?(nil)
    assert_not CompoundWriting.available_to?(user)

    Flipper.enable_actor(:compound_writing, user)
    assert CompoundWriting.available_to?(user)
    Flipper.disable_actor(:compound_writing, user)
    assert_not CompoundWriting.available_to?(user)

    Flipper.enable_group(:compound_writing, :admins)
    assert_not CompoundWriting.available_to?(user)
    user.update!(admin: true)
    assert CompoundWriting.available_to?(user)
    Flipper.disable_group(:compound_writing, :admins)

    Flipper.enable(:compound_writing)
    assert CompoundWriting.available_to?(user)
    assert_not CompoundWriting.available_to?(nil), "signed-out visitors never pass the gate"
  ensure
    Flipper.disable(:compound_writing)
  end
end
