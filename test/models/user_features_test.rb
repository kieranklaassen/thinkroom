require "test_helper"

class UserFeaturesTest < ActiveSupport::TestCase
  setup { @user = User.create!(name: "Kieran", email: "features@example.com", password: "thoughtful-passphrase") }

  test "a feature is granted once, readable, and revocable" do
    assert_not @user.feature?(:compound_writing)
    assert @user.grant_feature!(:compound_writing)
    assert @user.reload.feature?("compound_writing")
    assert @user.features.dig("compound_writing", "granted_at").present?
    assert_not @user.grant_feature!(:compound_writing), "granting twice changes nothing"
    assert @user.revoke_feature!(:compound_writing)
    assert_not @user.reload.feature?(:compound_writing)
    assert_not @user.revoke_feature!(:compound_writing)
  end

  test "unknown feature keys raise" do
    assert_raises(Features::UnknownFeature) { @user.feature?(:teleport) }
    assert_raises(Features::UnknownFeature) { @user.grant_feature!("") }
  end

  test "with_feature lists the holders" do
    other = User.create!(name: "Other", email: "other-features@example.com", password: "thoughtful-passphrase")
    @user.grant_feature!(:compound_writing)

    assert_equal [ @user ], User.with_feature(:compound_writing).to_a
    assert_not_includes User.with_feature(:compound_writing), other
  end

  test "available_to? needs a signed-in account holding the feature, not a configured judge" do
    assert_not CompoundWriting.available_to?(nil)
    assert_not CompoundWriting.available_to?(@user)
    @user.grant_feature!(:compound_writing)
    assert CompoundWriting.available_to?(@user)
  end
end
