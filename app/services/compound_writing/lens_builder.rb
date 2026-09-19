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
      @pack_slug = Lens.slug(pack_name)
      @curated = CuratedLenses.for_marketplace(marketplace)
    end

    def build
      dirs = skill_dirs
      slugs = assign_slugs(dirs)
      lenses = dirs.filter_map.with_index { |dir, index| lens_for(dir, slugs.fetch(dir), index) }
      raise Invalid, "the plugin has no skills that yield a lens" if lenses.empty?
      raise Invalid, "the plugin yields #{lenses.size} lenses (maximum #{Lens::MAX_LENSES_PER_PACK})" if lenses.size > Lens::MAX_LENSES_PER_PACK

      lenses.each_with_index.map { |lens, index| lens.with(color: index % Lens::COLOR_SLOTS) }
    end

    private

    attr_reader :files, :pack_slug, :curated

    # Curated order when a set exists (it is the reviewers' reading order),
    # else alphabetical.
    def skill_dirs
      present = files.keys.filter_map { |path| path[%r{\Askills/([^/]+)/#{SKILL_FILE}\z}, 1] }
      return present.sort unless curated

      curated.skill_names.select { |name| present.include?(name) }
    end

    # Two passes keep keys unique and deterministic: every directory whose
    # natural slug is still free takes it (so a folder literally named
    # "lens-2" keeps "lens-2"), then each remaining directory gets the first
    # "-N" suffix that no natural or generated slug has claimed.
    def assign_slugs(dirs)
      claimed = Set.new
      assigned = {}
      deferred = []
      dirs.each do |dir|
        slug = Lens.slug(dir)
        if claimed.add?(slug)
          assigned[dir] = slug
        else
          deferred << [ dir, slug ]
        end
      end
      deferred.each do |dir, slug|
        suffix = 2
        suffix += 1 until claimed.add?("#{slug}-#{suffix}")
        assigned[dir] = "#{slug}-#{suffix}"
      end
      assigned
    end

    def lens_for(skill_name, slug, index)
      skill_path = "skills/#{skill_name}/#{SKILL_FILE}"
      frontmatter = parse_frontmatter(files.fetch(skill_path), skill_path)
      key = "#{pack_slug}/#{slug}"
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

    # The description feeds a generated question, so it is reduced to one
    # printable line first and capped well under the question length.
    GENERATED_FOCUS_LENGTH = 240

    # Weak by design and labelled so: two literal questions built from the
    # skill's own description. Pack authors get sharper lenses with a sidecar.
    def generated(frontmatter, base)
      description = frontmatter["description"].to_s.gsub(Lens::UNPRINTABLE, " ").squish
      raise ArgumentError, "SKILL.md has no description to generate a lens from" if description.blank?

      focus = description.truncate(GENERATED_FOCUS_LENGTH, separator: " ")
      name = frontmatter["name"].to_s.gsub(Lens::UNPRINTABLE, " ").squish.presence || base[:key].split("/").last
      name = name.truncate(Lens::MAX_NAME_LENGTH, separator: " ")
      Lens.from_h(
        base.merge(
          name:, blurb: focus.truncate(90, separator: " "), origin: "generated",
          questions: [
            { id: "sentence", scope: "sentence", note: "Flagged by #{name}".truncate(Lens::MAX_NOTE_LENGTH, separator: " "),
              question: "Does this sentence show the problem this reviewer looks for: #{focus}?" },
            { id: "paragraph", scope: "paragraph", note: "Flagged by #{name}".truncate(Lens::MAX_NOTE_LENGTH, separator: " "),
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
