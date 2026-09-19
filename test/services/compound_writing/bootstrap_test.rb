require "test_helper"

class CompoundWriting::BootstrapTest < ActiveSupport::TestCase
  test "builds the compound-writing pack offline at the pinned SHA with thirteen curated lenses" do
    pack = CompoundWriting::Bootstrap.ensure_pack!

    assert_equal "compound-writing", pack.name
    assert_equal "EveryInc/compound-writing", pack.source_locator
    assert_equal "8fd0ec88c00976cf0274cb76552dc7ad9405ca92", pack.source_sha
    assert_equal "2.4.1", pack.version
    assert_nil pack.fetched_at
    assert_equal 13, pack.lens_structs.size
    assert_equal "compound-writing/cw-hemingway", pack.lens_structs.first.key
    assert pack.lens_structs.all? { |lens| lens.origin == "curated" && lens.lexicon.any? }
    assert_equal pack, CompoundWriting::Bootstrap.ensure_pack!, "idempotent"
    assert_equal 1, WritingPack.versions_of("EveryInc/compound-writing", "compound-writing").count
  end

  test "run! leaves an account that already holds a version of the plugin on that version" do
    user = User.create!(name: "K", email: "pinned@example.com", password: "thoughtful-passphrase")
    newer = WritingPack.create!(
      name: "compound-writing", display_name: "Compound Writing", source_locator: "EveryInc/compound-writing", plugin_name: "compound-writing",
      source_sha: "f" * 40, lenses: CompoundWriting::Bootstrap.ensure_pack!.lenses.first(1)
    )
    UserWritingPack.subscribe!(user, newer)

    CompoundWriting::Bootstrap.run!(emails: [ user.email ], logger: nil)

    assert_equal [ newer ], user.writing_packs.reload.to_a, "bootstrap never moves a version an account chose"
    assert_equal 1, user.user_writing_packs.count
  end

  test "run! grants and subscribes existing accounts, reports missing ones, and is idempotent" do
    user = User.create!(name: "K", email: "kieran@example.com", password: "thoughtful-passphrase")

    result = CompoundWriting::Bootstrap.run!(emails: [ "Kieran@Example.com", "nobody@example.com" ].map(&:downcase), logger: nil)

    assert_equal [ "kieran@example.com" ], result.granted
    assert_equal [ "kieran@example.com" ], result.subscribed
    assert_equal [ "nobody@example.com" ], result.missing
    assert user.reload.feature?(:compound_writing)
    assert_equal [ result.pack ], user.writing_packs.to_a

    again = CompoundWriting::Bootstrap.run!(emails: [ "kieran@example.com" ], logger: nil)
    assert_empty again.granted
    assert_empty again.subscribed
    assert_equal 1, user.user_writing_packs.count
  end

  test "initial accounts come from the environment, normalised" do
    assert_equal [], CompoundWriting::Bootstrap.initial_accounts(env: {})
    assert_equal %w[a@example.com b@example.com], CompoundWriting::Bootstrap.initial_accounts(env: { "COMPOUND_WRITING_INITIAL_ACCOUNTS" => " A@example.com, b@example.com ,, a@example.com" })
  end
end
