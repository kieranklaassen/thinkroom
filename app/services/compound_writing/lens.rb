module CompoundWriting
  # One reviewer as a pack carries it: which skill it came from, how it was
  # derived (sidecar, curated, generated), its colour slot, its questions,
  # and the lexicon the FakeJudge uses. Lenses travel as plain hashes in
  # `writing_packs.lenses` and `writing_passes.lenses`; this struct validates
  # and reads them.
  #
  # Pack-authored text becomes Jev instructions, so every field is bounded
  # here and a pack that breaks a bound fails to install rather than being
  # stored: caps on lenses per pack, questions per lens, and the length of
  # each name, blurb, note, question, and lexicon word, and every field must
  # be one line of printable text (no control or format characters).
  Lens = Data.define(:key, :name, :blurb, :color, :skill_path, :origin, :questions, :lexicon)

  class Lens
    SCOPES = %w[phrase sentence paragraph text].freeze
    ORIGINS = %w[sidecar curated generated].freeze
    DEFAULT_THRESHOLD = 0.7
    COLOR_SLOTS = 16
    KEY_PATTERN = %r{\A[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*\z}

    MAX_LENSES_PER_PACK = 40
    MAX_QUESTIONS_PER_LENS = 8
    MAX_KEY_LENGTH = 120
    MAX_NAME_LENGTH = 60
    MAX_BLURB_LENGTH = 160
    MAX_NOTE_LENGTH = 80
    MAX_QUESTION_LENGTH = 500
    MAX_QUESTION_ID_LENGTH = 40
    MAX_SKILL_PATH_LENGTH = 200
    MAX_LEXICON_WORDS = 40
    MAX_LEXICON_WORD_LENGTH = 40
    # Control, format, and line or paragraph separator characters: anything
    # that is not one visible line of text.
    UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/

    Question = Data.define(:id, :scope, :question, :note, :threshold)

    class Question
      def self.from_h(hash)
        hash = hash.to_h.with_indifferent_access
        question = Lens.text!(hash[:question], max: MAX_QUESTION_LENGTH, field: "question")
        new(
          id: Lens.text!(hash[:id], max: MAX_QUESTION_ID_LENGTH, field: "question id"),
          scope: hash[:scope].to_s,
          question:,
          note: Lens.text!(hash[:note].to_s.presence || question.truncate(60), max: MAX_NOTE_LENGTH, field: "note"),
          threshold: (hash[:threshold] || DEFAULT_THRESHOLD).to_f
        )
      end

      def to_h = { "id" => id, "scope" => scope, "question" => question, "note" => note, "threshold" => threshold }
    end

    # The key-safe form of a marketplace or skill name: "Wandering Sentences"
    # becomes "wandering-sentences", repeats collapse, a leading separator
    # ("_internal") drops, and an empty result falls back so a key always
    # parses.
    def self.slug(text)
      text.to_s.parameterize.sub(/\A[^a-z0-9]+/, "").presence || "lens"
    end

    # One line of printable text within +max+ characters, or ArgumentError.
    # Surrounding whitespace is dropped; nothing else is rewritten, so what
    # was validated is what gets stored and sent.
    def self.text!(value, max:, field:)
      text = value.to_s.strip
      raise ArgumentError, "#{field} is blank" if text.empty?
      raise ArgumentError, "#{field} contains a line break or non-printable character" if text.match?(UNPRINTABLE)
      raise ArgumentError, "#{field} is longer than #{max} characters" if text.length > max

      text
    end

    def self.from_h(hash)
      hash = hash.to_h.with_indifferent_access
      questions = Array(hash[:questions])
      raise ArgumentError, "lens #{hash[:key]} has #{questions.size} questions (maximum #{MAX_QUESTIONS_PER_LENS})" if questions.size > MAX_QUESTIONS_PER_LENS

      lens = new(
        key: hash[:key].to_s,
        name: text!(hash[:name], max: MAX_NAME_LENGTH, field: "lens #{hash[:key]} name"),
        blurb: hash[:blurb].to_s.strip.empty? ? "" : text!(hash[:blurb], max: MAX_BLURB_LENGTH, field: "lens #{hash[:key]} blurb"),
        color: hash[:color].to_i,
        skill_path: text!(hash[:skill_path], max: MAX_SKILL_PATH_LENGTH, field: "lens #{hash[:key]} skill path"),
        origin: hash[:origin].to_s,
        questions: questions.map { |question| Question.from_h(question) },
        lexicon: lexicon!(hash[:lexicon], key: hash[:key])
      )
      lens.validate!
    rescue ArgumentError => e
      raise ArgumentError, e.message.start_with?("lens ") ? e.message : "lens #{hash[:key]}: #{e.message}"
    end

    def self.lexicon!(value, key:)
      words = Array(value).map(&:to_s)
      raise ArgumentError, "lens #{key} lexicon has #{words.size} words (maximum #{MAX_LEXICON_WORDS})" if words.size > MAX_LEXICON_WORDS

      words.map { |word| text!(word, max: MAX_LEXICON_WORD_LENGTH, field: "lens #{key} lexicon word") }
    end

    def validate!
      raise ArgumentError, "lens key #{key.inspect} must be <pack>/<skill>" unless key.match?(KEY_PATTERN)
      raise ArgumentError, "lens key #{key} is longer than #{MAX_KEY_LENGTH} characters" if key.length > MAX_KEY_LENGTH
      raise ArgumentError, "lens #{key} has an unknown origin #{origin.inspect}" unless ORIGINS.include?(origin)
      raise ArgumentError, "lens #{key} has no questions" if questions.empty?
      raise ArgumentError, "lens #{key} colour slot must be 0-#{COLOR_SLOTS - 1}" unless (0...COLOR_SLOTS).cover?(color)

      ids = questions.map(&:id)
      raise ArgumentError, "lens #{key} repeats a question id" unless ids.uniq == ids
      questions.each do |question|
        raise ArgumentError, "lens #{key}.#{question.id} has an unknown scope #{question.scope.inspect}" unless SCOPES.include?(question.scope)
        raise ArgumentError, "lens #{key}.#{question.id} threshold must be within 0.05-0.95" unless question.threshold.between?(0.05, 0.95)
      end
      self
    end

    def question(id) = questions.find { |question| question.id == id }
    def pack_name = key.split("/", 2).first
    def skill_name = key.split("/", 2).last

    def to_h
      { "key" => key, "name" => name, "blurb" => blurb, "color" => color, "skill_path" => skill_path, "origin" => origin,
        "questions" => questions.map(&:to_h), "lexicon" => lexicon }
    end

    # What the client needs: the questions' prose stays server-side.
    def as_props
      { key:, name:, blurb:, color:, origin:, skill_path:, questions: questions.map { |question| { id: question.id, scope: question.scope, note: question.note } } }
    end
  end
end
