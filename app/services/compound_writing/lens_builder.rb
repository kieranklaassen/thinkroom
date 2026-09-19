module CompoundWriting
  # Turns a plugin's files (`{ path => bytes }`) into lenses. For each
  # `skills/<name>/SKILL.md`, in order: a `jev.yml` sidecar beside it wins;
  # else the curated set Thinkroom keeps for the marketplace; else a generated
  # lens from the skill's frontmatter description. See
  # docs/compound-writing-packs.md for the sidecar schema.
  class LensBuilder
    SIDECAR = "jev.yml"
    SKILL_FILE = "SKILL.md"

    class Invalid < StandardError; end

    def self.build(files, pack_name:, marketplace:)
      new(files, pack_name:, marketplace:).build
    end

    def initialize(files, pack_name:, marketplace:)
      @files = files
      @pack_name = pack_name
      @curated = CuratedLenses.for_marketplace(marketplace)
    end

    def build
      lenses = skill_dirs.filter_map.with_index { |dir, index| lens_for(dir, index) }
      raise Invalid, "the plugin has no skills that yield a lens" if lenses.empty?

      lenses.each_with_index.map { |lens, index| lens.with(color: index % Lens::COLOR_SLOTS) }
    end

    private

    attr_reader :files, :pack_name, :curated

    # Curated order when a set exists (it is the reviewers' reading order),
    # else alphabetical.
    def skill_dirs
      present = files.keys.filter_map { |path| path[%r{\Askills/([^/]+)/#{SKILL_FILE}\z}, 1] }
      return present.sort unless curated

      curated.skill_names.select { |name| present.include?(name) }
    end

    def lens_for(skill_name, index)
      skill_path = "skills/#{skill_name}/#{SKILL_FILE}"
      frontmatter = parse_frontmatter(files.fetch(skill_path), skill_path)
      key = "#{pack_name}/#{skill_name}"
      base = { key:, skill_path:, color: index % Lens::COLOR_SLOTS }

      if (sidecar = files["skills/#{skill_name}/#{SIDECAR}"])
        return from_definition(YAML.safe_load(sidecar, permitted_classes: [], aliases: false), base.merge(origin: "sidecar"), fallback_name: frontmatter["name"])
      end
      if curated
        skill = curated.skill(skill_name)
        return nil unless skill

        return from_definition(skill, base.merge(origin: "curated"), fallback_name: frontmatter["name"])
      end
      generated(frontmatter, base)
    rescue Psych::SyntaxError => e
      raise Invalid, "#{skill_path}: jev.yml is not valid YAML (#{e.message[0, 80]})"
    rescue ArgumentError => e
      raise Invalid, "#{skill_path}: #{e.message}"
    end

    def from_definition(definition, base, fallback_name:)
      raise ArgumentError, "lens definition must be a mapping" unless definition.is_a?(Hash)

      definition = definition.with_indifferent_access
      Lens.from_h(
        base.merge(
          name: definition[:name].presence || fallback_name.to_s.presence || base[:key].split("/").last,
          blurb: definition[:blurb].to_s, questions: definition[:questions], lexicon: definition[:lexicon]
        )
      )
    end

    # Weak by design and labelled so: two literal questions built from the
    # skill's own description. Pack authors get sharper lenses with a sidecar.
    def generated(frontmatter, base)
      description = frontmatter["description"].to_s.squish
      raise ArgumentError, "SKILL.md has no description to generate a lens from" if description.blank?

      focus = description.truncate(240, separator: " ")
      Lens.from_h(
        base.merge(
          name: frontmatter["name"].to_s.presence || base[:key].split("/").last, blurb: focus.truncate(90, separator: " "), origin: "generated",
          questions: [
            { id: "sentence", scope: "sentence", note: "Flagged by #{frontmatter['name']}",
              question: "Does this sentence show the problem this reviewer looks for: #{focus}?" },
            { id: "paragraph", scope: "paragraph", note: "Flagged by #{frontmatter['name']}",
              question: "Does this paragraph as a whole show the problem this reviewer looks for: #{focus}?" }
          ],
          lexicon: []
        )
      )
    end

    def parse_frontmatter(bytes, skill_path)
      RubyLLM::Skills::Parser.parse_string(bytes.to_s.dup.force_encoding(Encoding::UTF_8))
    rescue RubyLLM::Skills::ParseError, StandardError => e
      raise Invalid, "#{skill_path}: cannot read frontmatter (#{e.message[0, 80]})"
    end
  end
end
