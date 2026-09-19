module CompoundWriting
  # Installs a WritingPack version from a marketplace locator such as
  # `EveryInc/compound-writing`, `owner/repo@main`, or `owner/repo@<sha>`,
  # through ruby_llm-skills' marketplace layer: the ref resolves to a commit
  # (`head.sha`, the pin), `.claude-plugin/marketplace.json` names the
  # plugins, the plugin tree arrives as a tarball over HTTPS, and LensBuilder
  # derives the lenses. Nothing here runs git. A version that already exists
  # (same locator, plugin, and commit) is returned as it is; a new commit is a
  # new row. Subscribing the requester is the caller's step
  # (UserWritingPack.subscribe!), so installing never changes what another
  # account already holds.
  class PackInstaller
    LOCATOR = %r{\A(?<repo>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(?:@(?<ref>[A-Za-z0-9_./-]{1,120}))?\z}
    class Error < StandardError; end

    Parsed = Data.define(:locator, :ref)

    def self.parse(text)
      match = LOCATOR.match(text.to_s.strip)
      raise Error, "Enter a marketplace as owner/repo, optionally @branch or @commit" unless match

      Parsed.new(locator: match[:repo], ref: match[:ref])
    end

    # fetcher: injectable for tests; defaults to the gem's GitHub fetcher.
    def self.install!(locator, plugin: nil, fetcher: nil)
      new(parse(locator), plugin:, fetcher:).install!
    end

    def initialize(parsed, plugin: nil, fetcher: nil)
      @parsed = parsed
      @plugin = plugin
      @fetcher = fetcher
    end

    def install!
      CompoundWriting.configure_marketplaces!
      head = fetcher.head
      catalog = RubyLLM::Skills::Marketplace::Manifest.discover(fetcher.catalog_files(head))
      entry = pick_plugin(catalog)
      existing = WritingPack.find_by(source_locator: parsed.locator, plugin_name: entry.name, source_sha: head.sha)
      return existing if existing

      fetched = fetcher.source_tree(entry.source, head:)
      lenses = LensBuilder.build(fetched.files, pack_name: catalog.name, marketplace: parsed.locator)
      persist!(catalog, entry, fetched.sha, lenses)
    rescue RubyLLM::Skills::Marketplace::FetchError, RubyLLM::Skills::Marketplace::InvalidManifestError, LensBuilder::Invalid => e
      raise Error, e.message
    end

    private

    attr_reader :parsed

    def fetcher
      @fetcher ||= RubyLLM::Skills::Marketplace::Fetcher.for(
        RubyLLM::Skills::Marketplace::Locator::Source.new(kind: "github", locator: parsed.locator, ref: parsed.ref)
      )
    end

    # A plugin must live in the marketplace repository itself: a relative
    # source, or a github source naming the same owner/repo. Any other
    # repository, archive, or hosted URL would make this server fetch (and
    # send its token to) an address the marketplace author chose.
    def installable?(entry)
      return false unless entry.supported?

      case entry.source.kind
      when "relative" then true
      when "github" then entry.source.repo.to_s.casecmp?(parsed.locator)
      else false
      end
    end

    def pick_plugin(catalog)
      supported = catalog.plugins.select { |entry| installable?(entry) }
      if supported.empty?
        raise Error, "#{parsed.locator} lists no installable plugins: a plugin must live in the marketplace repository itself " \
                     "(a relative source, or a github source naming #{parsed.locator})"
      end
      return supported.first if @plugin.blank? && supported.one?
      raise Error, "#{parsed.locator} has #{supported.size} plugins; name one: #{supported.map(&:name).join(', ')}" if @plugin.blank?

      supported.find { |candidate| candidate.name == @plugin } || raise(Error, "#{parsed.locator} has no installable plugin named #{@plugin}")
    end

    def persist!(catalog, entry, sha, lenses)
      WritingPack.create!(
        name: catalog.name, display_name: catalog.display_name.presence || catalog.name,
        description: entry.description.presence || catalog.description,
        source_kind: "github", source_locator: parsed.locator, source_ref: parsed.ref, source_sha: sha, plugin_name: entry.name,
        version: entry.version.presence || catalog.version,
        lenses: lenses.map(&:to_h), fetched_at: Time.current
      )
    rescue ActiveRecord::RecordNotUnique
      # Two installs of the same commit raced; the first one's row is the version.
      WritingPack.find_by!(source_locator: parsed.locator, plugin_name: entry.name, source_sha: sha)
    rescue ActiveRecord::RecordInvalid => e
      raise Error, e.record.errors.full_messages.to_sentence
    end
  end
end
