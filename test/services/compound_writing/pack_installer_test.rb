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

  test "a version is immutable: the same commit returns the same row untouched, a new commit is a new row" do
    first = CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: MARKETPLACE, files:))
    fewer = files.except("skills/bluff/SKILL.md")

    same = CompoundWriting::PackInstaller.install!("acme/lenses@main", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: MARKETPLACE, files: fewer))
    assert_equal first.id, same.id
    assert_equal %w[acme-lenses/bluff acme-lenses/wander], same.reload.lens_keys, "an existing version's lenses are never rewritten"

    second = CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "b" * 40, marketplace: MARKETPLACE, files: fewer))
    assert_not_equal first.id, second.id
    assert_equal "b" * 40, second.source_sha
    assert_equal %w[acme-lenses/wander], second.lens_keys
    assert_equal %w[acme-lenses/bluff acme-lenses/wander], first.reload.lens_keys
    assert_equal [ second, first ], WritingPack.versions_of("acme/lenses", "acme-lenses").to_a
  end

  test "a pack row cannot be rewritten after it is created" do
    pack = CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: MARKETPLACE, files:))

    assert_raises(ActiveRecord::ReadonlyAttributeError) { pack.update!(lenses: []) }
    assert_raises(ActiveRecord::ReadonlyAttributeError) { pack.update!(source_sha: "c" * 40) }
  end

  test "re-adding a locator moves only the requester's subscription and keeps choices for surviving lenses" do
    first = CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: MARKETPLACE, files:))
    requester = User.create!(name: "R", email: "requester@example.com", password: PASSWORD)
    bystander = User.create!(name: "B", email: "bystander@example.com", password: PASSWORD)
    UserWritingPack.subscribe!(requester, first).subscription.update_disabled!(%w[acme-lenses/wander acme-lenses/bluff])
    UserWritingPack.subscribe!(bystander, first)

    second = CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "b" * 40, marketplace: MARKETPLACE, files: files.except("skills/bluff/SKILL.md")))
    outcome = UserWritingPack.subscribe!(requester, second)

    assert outcome.moved?
    assert_equal [ second ], requester.writing_packs.reload.to_a
    assert_equal %w[acme-lenses/wander], outcome.subscription.reload.disabled_lens_keys
    assert_equal [ first ], bystander.writing_packs.reload.to_a, "the other subscriber keeps the version it chose"
    assert UserWritingPack.subscribe!(requester, second).unchanged?
  end

  test "github plugin sources must name the marketplace repository itself" do
    same_repo = MARKETPLACE.merge("plugins" => [ { "name" => "acme-lenses", "source" => { "source" => "github", "repo" => "Acme/Lenses" } } ])
    pack = CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: same_repo, files:))
    assert_equal "acme-lenses", pack.plugin_name

    other_repo = MARKETPLACE.merge("plugins" => [ { "name" => "acme-lenses", "source" => { "source" => "github", "repo" => "someone-else/private-repo" } } ])
    error = assert_raises(CompoundWriting::PackInstaller::Error) do
      CompoundWriting::PackInstaller.install!("acme/lenses@v2", fetcher: FetcherDouble.new(sha: "b" * 40, marketplace: other_repo, files:))
    end
    assert_match(/must live in the marketplace repository itself/, error.message)
    assert_nil WritingPack.find_by(source_sha: "b" * 40)
  end

  test "a pack whose lens content breaks a bound fails to install" do
    # The YAML double-quoted `\n` escape keeps a real line break in the question.
    bad = files.merge("skills/wander/jev.yml" => %(blurb: Wandering.\nquestions:\n  - { id: w, scope: sentence, question: "Line one\\nLine two?" }\n))

    error = assert_raises(CompoundWriting::PackInstaller::Error) do
      CompoundWriting::PackInstaller.install!("acme/lenses", fetcher: FetcherDouble.new(sha: "a" * 40, marketplace: MARKETPLACE, files: bad))
    end
    assert_match(/question contains a line break/, error.message)
    assert_nil WritingPack.find_by(source_locator: "acme/lenses")
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
