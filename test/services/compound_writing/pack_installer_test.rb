require "test_helper"

class CompoundWriting::PackInstallerTest < ActiveSupport::TestCase
  include CompoundWritingHelpers

  # Stands in for ruby_llm-skills' GitHub fetcher: a marketplace file and a
  # plugin tree, no network.
  class FetcherDouble
    Head = RubyLLM::Skills::Marketplace::Fetcher::Head
    Fetched = RubyLLM::Skills::Marketplace::Fetcher::Fetched

    def initialize(sha:, marketplace:, files:)
      @sha = sha
      @marketplace = marketplace
      @files = files
    end

    def head(**) = Head.new(sha: @sha, etag: nil, unchanged: false)
    def catalog_files(_head) = { ".claude-plugin/marketplace.json" => @marketplace.to_json }
    def source_tree(_plugin_source, head:) = Fetched.new(files: @files, sha: head.sha, upstream_url: "https://example.test")
  end

  MARKETPLACE = {
    "name" => "acme-lenses", "owner" => { "name" => "Acme" }, "metadata" => { "description" => "Acme's lenses", "version" => "1.2.0" },
    "plugins" => [ { "name" => "acme-lenses", "description" => "Two lenses", "version" => "1.2.0", "source" => "./" } ]
  }.freeze

  def files
    {
      "skills/wander/SKILL.md" => "---\nname: wander\ndescription: Finds wandering sentences.\n---\n# wander\n",
      "skills/wander/jev.yml" => "blurb: Wandering.\nquestions:\n  - { id: w, scope: sentence, question: Does this sentence wander? }\n",
      "skills/bluff/SKILL.md" => "---\nname: bluff\ndescription: Finds unsupported claims.\n---\n# bluff\n"
    }
  end

  test "parse accepts owner/repo with an optional ref" do
    assert_equal [ "EveryInc/compound-writing", nil ], CompoundWriting::PackInstaller.parse(" EveryInc/compound-writing ").to_h.values
    assert_equal [ "acme/lenses", "main" ], CompoundWriting::PackInstaller.parse("acme/lenses@main").to_h.values
    assert_equal "8fd0ec88c00976cf0274cb76552dc7ad9405ca92", CompoundWriting::PackInstaller.parse("acme/lenses@8fd0ec88c00976cf0274cb76552dc7ad9405ca92").ref
    assert_raises(CompoundWriting::PackInstaller::Error) { CompoundWriting::PackInstaller.parse("https://github.com/acme/lenses") }
    assert_raises(CompoundWriting::PackInstaller::Error) { CompoundWriting::PackInstaller.parse("acme") }
  end

  test "install! pins the head, reads the manifest, and derives lenses in skill order" do
    fetcher = FetcherDouble.new(sha: "a" * 40, marketplace: MARKETPLACE, files:)

    pack = CompoundWriting::PackInstaller.install!("acme/lenses@main", fetcher:)

    assert_equal "acme-lenses", pack.name
    assert_equal "1.2.0", pack.version
    assert_equal "a" * 40, pack.source_sha
    assert_equal "main", pack.source_ref
    assert_equal %w[acme-lenses/bluff acme-lenses/wander], pack.lens_keys
    assert_equal %w[generated sidecar], pack.lens_structs.map(&:origin)
    assert pack.fetched_at.present?
  end

  test "reinstalling refreshes the same row and keeps a subscriber's choices for surviving lenses" do
    first = CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: MARKETPLACE, files:))
    user = User.create!(name: "U", email: "packs@example.com", password: PASSWORD)
    subscription = UserWritingPack.create!(user:, writing_pack: first, disabled_lens_keys: %w[acme-lenses/wander acme-lenses/bluff])

    fewer = files.except("skills/bluff/SKILL.md")
    second = CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "b" * 40, marketplace: MARKETPLACE, files: fewer))

    assert_equal first.id, second.id
    assert_equal "b" * 40, second.source_sha
    assert_equal %w[acme-lenses/wander], second.lens_keys
    subscription.reload.update_disabled!(subscription.disabled_lens_keys)
    assert_equal %w[acme-lenses/wander], subscription.reload.disabled_lens_keys
  end

  test "a marketplace with several plugins needs a plugin name" do
    marketplace = MARKETPLACE.merge("plugins" => MARKETPLACE["plugins"] + [ { "name" => "acme-more", "source" => "./more" } ])
    fetcher = FetcherDouble.new(sha: "a" * 40, marketplace:, files:)

    error = assert_raises(CompoundWriting::PackInstaller::Error) { CompoundWriting::PackInstaller.install!("acme/lenses", fetcher:) }
    assert_match(/has 2 plugins; name one: acme-lenses, acme-more/, error.message)
    assert_equal "acme-lenses", CompoundWriting::PackInstaller.install!("acme/lenses", plugin: "acme-lenses", fetcher:).plugin_name
  end

  test "archive and hosted-URL plugin sources are refused" do
    marketplace = MARKETPLACE.merge("plugins" => [ { "name" => "acme-lenses", "source" => { "source" => "url", "url" => "https://evil.test/plugin.tar.gz" } } ])
    fetcher = FetcherDouble.new(sha: "a" * 40, marketplace:, files:)

    error = assert_raises(CompoundWriting::PackInstaller::Error) { CompoundWriting::PackInstaller.install!("acme/lenses", fetcher:) }
    assert_match(/no installable plugins/, error.message)
  end

  test "an invalid manifest or an empty plugin is an installer error" do
    assert_raises(CompoundWriting::PackInstaller::Error) do
      CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: { "name" => "x" }, files:))
    end
    assert_raises(CompoundWriting::PackInstaller::Error) do
      CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: MARKETPLACE, files: { "README.md" => "" }))
    end
    assert_nil WritingPack.find_by(source_locator: "acme/lenses")
  end
end
