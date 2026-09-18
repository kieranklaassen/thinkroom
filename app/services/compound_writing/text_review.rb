module CompoundWriting
  # One reviewer's whole-text questions over the document: one Noul per text
  # question, state = every paragraph joined with blank lines. Findings carry
  # no paragraph anchor; the panel shows them on the reviewer.
  class TextReview
    def initialize(reviewer, judge: CompoundWriting.judge)
      @reviewer = reviewer
      @judge = judge
    end

    def call(paragraphs)
      questions = @reviewer.questions.select { |question| question.scope == "text" }
      text = paragraphs.map { |paragraph| paragraph["text"].to_s }.reject(&:blank?).join("\n\n")
      return [] if questions.empty? || text.blank?

      nouls = questions.map { |question| Prompts.text(question, @reviewer, text) }
      probabilities = @judge.judge(state: { text: }, nouls:)
      questions.zip(probabilities).filter_map do |question, probability|
        next if probability < question.threshold

        ParagraphReview::Finding.new(
          reviewer_key: @reviewer.key, question_id: question.id, scope: "text", paragraph_index: nil, paragraph_text: nil,
          quote: nil, quote_offset: nil, probability:
        )
      end
    end
  end
end
