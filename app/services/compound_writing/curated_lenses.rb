module CompoundWriting
  # Thinkroom's own question sets for marketplaces whose skills carry no
  # `jev.yml` sidecar, one YAML per marketplace in config/compound_writing/
  # lenses/<owner>--<repo>.yml keyed by skill directory name. When a set
  # exists for a marketplace, only its skills become lenses: the other skills
  # are writing tools (draft, outline), not reviewers.
  module CuratedLenses
    ROOT = Rails.root.join("config/compound_writing/lenses")

    Set = Data.define(:marketplace, :pinned_sha, :version, :display_name, :description, :skills) do
      def skill(name) = skills[name.to_s]
      def skill_names = skills.keys
    end

    module_function

    def for_marketplace(locator)
      path = ROOT.join("#{file_stem(locator)}.yml")
      return nil unless path.file?

      data = YAML.safe_load_file(path, permitted_classes: [], aliases: false) || {}
      Set.new(
        marketplace: data["marketplace"].to_s, pinned_sha: data["pinned_sha"].to_s, version: data["version"].to_s,
        display_name: data["display_name"].to_s, description: data["description"].to_s,
        skills: (data["skills"] || {}).to_h { |name, skill| [ name.to_s, skill.to_h ] }
      )
    end

    def file_stem(locator) = locator.to_s.downcase.strip.sub("/", "--")
  end
end
