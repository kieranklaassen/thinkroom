require "test_helper"

class WritingPacksFlowTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers

  setup { @user = featured_user! }

  def subscription = @user.user_writing_packs.first

  test "pack endpoints refuse signed-out visitors and accounts without the feature" do
    patch writing_pack_path(compound_pack), params: { disabled_lens_keys: [ "compound-writing/cw-mom" ] }, as: :json
    assert_response :forbidden
    assert_empty subscription.reload.disabled_lens_keys

    plain = User.create!(name: "Plain", email: "plain@example.com", password: PASSWORD)
    sign_in_as(plain)
    post writing_packs_path, params: { locator: "EveryInc/compound-writing" }, as: :json
    assert_response :forbidden
    delete writing_pack_path(compound_pack), as: :json
    assert_response :forbidden
    assert_equal 1, compound_pack.user_writing_packs.count
  end

  test "a featured account switches lenses off and on for its own subscription only" do
    other = featured_user!(email: "other@example.com")
    sign_in_as(@user)

    patch writing_pack_path(compound_pack), params: { disabled_lens_keys: [ "compound-writing/cw-mom", "nope/x" ] }, as: :json
    assert_response :see_other
    assert_equal [ "compound-writing/cw-mom" ], subscription.reload.disabled_lens_keys, "unknown keys are dropped"
    assert_empty other.user_writing_packs.first.disabled_lens_keys

    patch writing_pack_path(compound_pack), params: { disabled_lens_keys: [] }, as: :json
    assert_empty subscription.reload.disabled_lens_keys
  end

  test "removing a pack drops only this account's subscription; the version row stays" do
    other = featured_user!(email: "other@example.com")
    sign_in_as(@user)

    delete writing_pack_path(compound_pack), as: :json

    assert_response :see_other
    assert_empty @user.user_writing_packs.reload
    assert_equal 1, other.user_writing_packs.count
    assert WritingPack.exists?(compound_pack.id)
  end

  test "a bad locator is an inline error, not an exception" do
    sign_in_as(@user)

    post writing_packs_path, params: { locator: "https://github.com/acme/lenses" }
    assert_response :redirect
    assert_match(/owner\/repo/, session[:inertia_errors][:writing_pack])
  end
end
