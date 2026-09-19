module CompoundWriting
  # First-run setup that needs no network: the compound-writing pack built
  # from Thinkroom's curated set at the SHA the set was written against, the
  # feature granted, and the pack subscribed for the accounts named in
  # COMPOUND_WRITING_INITIAL_ACCOUNTS. Idempotent; the migration and
  # db/seeds.rb both call it. Accounts that do not exist yet are logged and
  # picked up later with `features:grant` and the panel's Add pack.
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
        subscription = UserWritingPack.find_or_initialize_by(user:, writing_pack: pack)
        if subscription.new_record?
          subscription.position = (user.user_writing_packs.maximum(:position) || -1) + 1
          subscription.save!
          subscribed << email
        end
      end
      logger&.info("[compound] bootstrap pack=#{pack.name}@#{pack.short_sha} granted=#{granted.size} subscribed=#{subscribed.size} missing=#{missing.join(',')}")
      Result.new(pack:, granted:, subscribed:, missing:)
    end

    # The curated set is complete enough to stand in for a fetch: the same
    # lenses PackInstaller derives from the repository at the pinned SHA. A
    # pack that already exists (installed live, or by an earlier run) is left
    # as it is.
    def ensure_pack!
      curated = CuratedLenses.for_marketplace(MARKETPLACE) or raise "no curated lens set for #{MARKETPLACE}"
      pack = WritingPack.find_or_initialize_by(source_locator: MARKETPLACE, plugin_name: PLUGIN)
      return pack unless pack.new_record?

      lenses = curated.skill_names.each_with_index.map do |skill_name, index|
        skill = curated.skill(skill_name)
        Lens.from_h(
          key: "#{PLUGIN}/#{skill_name}", name: skill["name"], blurb: skill["blurb"], color: index % Lens::COLOR_SLOTS,
          skill_path: "skills/#{skill_name}/SKILL.md", origin: "curated", questions: skill["questions"], lexicon: skill["lexicon"]
        )
      end
      pack.assign_attributes(
        name: PLUGIN, display_name: curated.display_name.presence || PLUGIN, description: curated.description,
        source_kind: "github", source_ref: curated.pinned_sha, source_sha: curated.pinned_sha, version: curated.version,
        lenses: lenses.map(&:to_h), fetched_at: nil
      )
      pack.save!
      pack
    end
  end
end
