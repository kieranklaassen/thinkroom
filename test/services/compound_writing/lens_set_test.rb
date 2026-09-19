require "test_helper"

class CompoundWriting::LensSetTest < ActiveSupport::TestCase
  include CompoundWritingHelpers

  def lens_hash(pack, skill, color: 0)
    { "key" => "#{pack}/#{skill}", "name" => skill.titleize, "blurb" => "b", "color" => color, "skill_path" => "skills/#{skill}/SKILL.md", "origin" => "sidecar",
      "questions" => [ { "id" => "q", "scope" => "sentence", "question" => "Q?", "note" => "n", "threshold" => 0.7 } ], "lexicon" => [] }
  end

  test "returns enabled lenses across packs in order, skipping disabled keys and duplicate keys" do
    user = featured_user!
    other = WritingPack.create!(name: "acme", display_name: "Acme", source_locator: "acme/lenses", source_sha: "b" * 40, plugin_name: "acme",
                                lenses: [ lens_hash("acme", "wander"), lens_hash("compound-writing", "cw-mom", color: 1) ])
    UserWritingPack.create!(user:, writing_pack: other, position: 1, disabled_lens_keys: %w[acme/wander])
    user.user_writing_packs.first.update_disabled!(%w[compound-writing/cw-bluf])

    set = CompoundWriting::LensSet.for(user)

    assert_equal 12, set.keys.count { |key| key.start_with?("compound-writing/") }, "thirteen curated lenses minus the disabled one"
    assert_not_includes set.keys, "compound-writing/cw-bluf"
    assert_not_includes set.keys, "acme/wander"
    assert_equal "Mom", set.find("compound-writing/cw-mom").name, "the first pack's definition wins a duplicate key"
    assert_equal 2, set.packs_props.size
    assert_equal false, set.packs_props.first[:lenses].find { |lens| lens[:key] == "compound-writing/cw-bluf" }[:enabled]
  end

  test "select! validates requested keys against the enabled set" do
    user = featured_user!
    set = CompoundWriting::LensSet.for(user)

    assert_equal %w[compound-writing/cw-mom], set.select!(%w[compound-writing/cw-mom compound-writing/cw-mom]).map(&:key)
    error = assert_raises(ArgumentError) { set.select!(%w[compound-writing/cw-mom nope/x]) }
    assert_match(/unknown or disabled reviewers nope\/x/, error.message)
  end

  test "nobody and an account without packs have an empty set" do
    assert CompoundWriting::LensSet.for(nil).empty?
    user = User.create!(name: "U", email: "empty@example.com", password: PASSWORD)
    assert CompoundWriting::LensSet.for(user).empty?
  end
end
