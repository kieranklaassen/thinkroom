module CompoundWriting
  # The pack every enabled account starts with: EveryInc/compound-writing at
  # the SHA Thinkroom's curated set was written against, built offline from
  # that set (the same lenses PackInstaller derives from the repository at
  # that commit). An account is subscribed lazily, once, on its first
  # Comment-mode visit after the flag is enabled; `compound_writing_seeded_at`
  # records that, so an account that later removes the pack is not re-seeded.
  module FirstPack
    MARKETPLACE = "EveryInc/compound-writing"
    PLUGIN = "compound-writing"

    module_function

    # Subscribes +user+ to the first pack if it has never been seeded. Returns
    # true when a subscription was created.
    def seed!(user)
      return false if user.compound_writing_seeded_at.present?

      pack = ensure_pack!
      created = false
      user.with_lock do
        break if user.compound_writing_seeded_at.present?

        already = user.user_writing_packs.joins(:writing_pack).exists?(writing_packs: { source_locator: pack.source_locator, plugin_name: pack.plugin_name })
        created = !already && UserWritingPack.subscribe!(user, pack).created?
        user.update!(compound_writing_seeded_at: Time.current)
      end
      Rails.logger.info("[compound] first pack #{created ? 'subscribed' : 'already present'} for user #{user.id}") if created
      created
    end

    # The version row for the pinned SHA, created once and never changed.
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
    rescue ActiveRecord::RecordNotUnique
      WritingPack.find_by!(source_locator: MARKETPLACE, plugin_name: PLUGIN, source_sha: curated.pinned_sha)
    end
  end
end
