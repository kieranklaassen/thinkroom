require "test_helper"

class CompoundWriting::FirstPackTest < ActiveSupport::TestCase
  test "builds the compound-writing pack offline at the pinned SHA with thirteen curated lenses, once" do
    pack = CompoundWriting::FirstPack.ensure_pack!

    assert_equal "compound-writing", pack.name
    assert_equal "EveryInc/compound-writing", pack.source_locator
    assert_equal "8fd0ec88c00976cf0274cb76552dc7ad9405ca92", pack.source_sha
    assert_equal "2.4.1", pack.version
    assert_nil pack.fetched_at
    assert_equal 13, pack.lens_structs.size
    assert_equal "compound-writing/cw-hemingway", pack.lens_structs.first.key
    assert pack.lens_structs.all? { |lens| lens.origin == "curated" && lens.lexicon.any? }
    assert_equal pack, CompoundWriting::FirstPack.ensure_pack!
    assert_equal 1, WritingPack.versions_of("EveryInc/compound-writing", "compound-writing").count
  end

  test "seed! subscribes an account once and never again after it removes the pack" do
    user = User.create!(name: "K", email: "seed@example.com", password: "thoughtful-passphrase")

    assert CompoundWriting::FirstPack.seed!(user)
    assert_equal [ "EveryInc/compound-writing" ], user.writing_packs.map(&:source_locator)
    assert user.reload.compound_writing_seeded_at.present?
    assert_not CompoundWriting::FirstPack.seed!(user), "a second call is a no-op"

    user.user_writing_packs.destroy_all
    assert_not CompoundWriting::FirstPack.seed!(user), "a deliberate removal sticks"
    assert_empty user.writing_packs.reload
  end

  test "seed! leaves an account that already chose another version on that version" do
    user = User.create!(name: "K", email: "pinned@example.com", password: "thoughtful-passphrase")
    newer = WritingPack.create!(
      name: "compound-writing", display_name: "Compound Writing", source_locator: "EveryInc/compound-writing", plugin_name: "compound-writing",
      source_sha: "f" * 40, lenses: CompoundWriting::FirstPack.ensure_pack!.lenses.first(1)
    )
    UserWritingPack.subscribe!(user, newer)

    assert_not CompoundWriting::FirstPack.seed!(user)
    assert_equal [ newer ], user.writing_packs.reload.to_a
    assert user.reload.compound_writing_seeded_at.present?
  end
end
