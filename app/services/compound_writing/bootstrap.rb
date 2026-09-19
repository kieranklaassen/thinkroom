module CompoundWriting
  # First-run setup that needs no network: the compound-writing pack built
  # from Thinkroom's curated set at the SHA the set was written against, the
  # feature granted, and the pack subscribed for the accounts named in
  # COMPOUND_WRITING_INITIAL_ACCOUNTS that hold no version of it yet.
  # Idempotent; the migration and db/seeds.rb both call it. Accounts that do
  # not exist yet are logged and picked up later with `features:grant` and
  # the panel's Add pack.
  module Bootstrap
    MARKETPLACE = "EveryInc/compound-writing"
    PLUGIN = "compound-writing"

    Result = Data.define(:pack, :granted, :subscribed, :missing)

    module_function

    def initial_accounts(env: ENV)
      env["COMPOUND_WRITING_INITIAL_ACCOUNTS"].to_s.split(",").map { |email| email.strip.downcase }.reject(&:blank?).uniq
    end

    def run!(emails: initial_accounts, logger: Rails.logger)
      pack = ensure_pack!
      granted = []
      subscribed = []
      missing = []
      emails.each do |email|
        user = User.find_by(email:)
        if user.nil?
          missing << email
          next
        end
        granted << email if user.grant_feature!(Features::COMPOUND_WRITING)
        # An account that already holds any version of this plugin keeps it;
        # the bootstrap only fills in accounts that have nothing yet.
        next if user.user_writing_packs.joins(:writing_pack).exists?(writing_packs: { source_locator: pack.source_locator, plugin_name: pack.plugin_name })

        subscribed << email if UserWritingPack.subscribe!(user, pack).created?
      end
      logger&.info("[compound] bootstrap pack=#{pack.name}@#{pack.short_sha} granted=#{granted.size} subscribed=#{subscribed.size} missing=#{missing.join(',')}")
      Result.new(pack:, granted:, subscribed:, missing:)
    end

    # The curated set is complete enough to stand in for a fetch: the same
    # lenses PackInstaller derives from the repository at the pinned SHA. The
    # version row for that SHA is created once and never changed.
    def ensure_pack!
      curated = CuratedLenses.for_marketplace(MARKETPLACE) or raise "no curated lens set for #{MARKETPLACE}"
      pack = WritingPack.find_or_initialize_by(source_locator: MARKETPLACE, plugin_name: PLUGIN, source_sha: curated.pinned_sha)
      return pack unless pack.new_record?

      lenses = curated.skill_names.each_with_index.map do |skill_name, index|
        skill = curated.skill(skill_name)
        Lens.from_h(
          key: "#{Lens.slug(PLUGIN)}/#{Lens.slug(skill_name)}", name: skill["name"], blurb: skill["blurb"], color: index % Lens::COLOR_SLOTS,
          skill_path: "skills/#{skill_name}/SKILL.md", origin: "curated", questions: skill["questions"], lexicon: skill["lexicon"]
        )
      end
      pack.assign_attributes(
        name: PLUGIN, display_name: curated.display_name.presence || PLUGIN, description: curated.description,
        source_kind: "github", source_ref: curated.pinned_sha, version: curated.version,
        lenses: lenses.map(&:to_h), fetched_at: nil
      )
      pack.save!
      pack
    end
  end
end
