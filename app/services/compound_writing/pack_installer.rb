module CompoundWriting
  # Installs or refreshes a WritingPack from a marketplace locator such as
  # `EveryInc/compound-writing`, `owner/repo@main`, or `owner/repo@<sha>`,
  # through ruby_llm-skills' marketplace layer: the ref resolves to a commit
  # (`head.sha`, the pin), `.claude-plugin/marketplace.json` names the
  # plugins, the plugin tree arrives as a tarball over HTTPS, and LensBuilder
  # derives the lenses. Nothing here runs git; the pack row is the lock.
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

    # Plugins that live in the marketplace repository itself or in another
    # GitHub repository. Archive and hosted-URL sources would have the server
    # fetch an address the marketplace author chose, so they are refused.
    SOURCE_KINDS = %w[relative github].freeze

    def pick_plugin(catalog)
      supported = catalog.plugins.select { |entry| entry.supported? && SOURCE_KINDS.include?(entry.source.kind) }
      raise Error, "#{parsed.locator} lists no installable plugins (sources must live in the repository or on GitHub)" if supported.empty?
      return supported.first if @plugin.blank? && supported.one?
      raise Error, "#{parsed.locator} has #{supported.size} plugins; name one: #{supported.map(&:name).join(', ')}" if @plugin.blank?

      supported.find { |candidate| candidate.name == @plugin } || raise(Error, "#{parsed.locator} has no plugin named #{@plugin}")
    end

    def persist!(catalog, entry, sha, lenses)
      pack = WritingPack.find_or_initialize_by(source_locator: parsed.locator, plugin_name: entry.name)
      pack.assign_attributes(
        name: catalog.name, display_name: catalog.display_name.presence || catalog.name,
        description: entry.description.presence || catalog.description,
        source_kind: "github", source_ref: parsed.ref, source_sha: sha, version: entry.version.presence || catalog.version,
        lenses: lenses.map(&:to_h), fetched_at: Time.current
      )
      pack.save!
      pack
    end
  end
end
