module CompoundWriting
  # One reviewer as a pack carries it: which skill it came from, how it was
  # derived (sidecar, curated, generated), its colour slot, its questions,
  # and the lexicon the FakeJudge uses. Lenses travel as plain hashes in
  # `writing_packs.lenses` and `writing_passes.lenses`; this struct validates
  # and reads them.
  Lens = Data.define(:key, :name, :blurb, :color, :skill_path, :origin, :questions, :lexicon)

  class Lens
    SCOPES = %w[phrase sentence paragraph text].freeze
    ORIGINS = %w[sidecar curated generated].freeze
    DEFAULT_THRESHOLD = 0.7
    COLOR_SLOTS = 16
    KEY_PATTERN = %r{\A[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*\z}

    Question = Data.define(:id, :scope, :question, :note, :threshold)

    class Question
      def self.from_h(hash)
        hash = hash.to_h.with_indifferent_access
        new(
          id: hash[:id].to_s, scope: hash[:scope].to_s, question: hash[:question].to_s,
          note: hash[:note].to_s.presence || hash[:question].to_s.truncate(60),
          threshold: (hash[:threshold] || DEFAULT_THRESHOLD).to_f
        )
      end

      def to_h = { "id" => id, "scope" => scope, "question" => question, "note" => note, "threshold" => threshold }
    end

    def self.from_h(hash)
      hash = hash.to_h.with_indifferent_access
      lens = new(
        key: hash[:key].to_s, name: hash[:name].to_s, blurb: hash[:blurb].to_s, color: hash[:color].to_i,
        skill_path: hash[:skill_path].to_s, origin: hash[:origin].to_s,
        questions: Array(hash[:questions]).map { |question| Question.from_h(question) },
        lexicon: Array(hash[:lexicon]).map(&:to_s)
      )
      lens.validate!
    end

    def validate!
      raise ArgumentError, "lens key #{key.inspect} must be <pack>/<skill>" unless key.match?(KEY_PATTERN)
      raise ArgumentError, "lens #{key} needs a name" if name.blank?
      raise ArgumentError, "lens #{key} has an unknown origin #{origin.inspect}" unless ORIGINS.include?(origin)
      raise ArgumentError, "lens #{key} has no questions" if questions.empty?
      raise ArgumentError, "lens #{key} colour slot must be 0-#{COLOR_SLOTS - 1}" unless (0...COLOR_SLOTS).cover?(color)

      ids = questions.map(&:id)
      raise ArgumentError, "lens #{key} repeats a question id" unless ids.uniq == ids
      questions.each do |question|
        raise ArgumentError, "lens #{key} question #{question.id.inspect} needs an id" if question.id.blank?
        raise ArgumentError, "lens #{key}.#{question.id} has an unknown scope #{question.scope.inspect}" unless SCOPES.include?(question.scope)
        raise ArgumentError, "lens #{key}.#{question.id} needs a question" if question.question.blank?
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
