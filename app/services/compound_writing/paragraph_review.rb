module CompoundWriting
  # One reviewer over one paragraph: build every Noul the reviewer's questions
  # need, ask the judge once (state = the paragraph), and keep the flagged
  # units as finding attributes. Headings get phrase questions only; short
  # paragraphs skip paragraph-scope questions (KTD9).
  class ParagraphReview
    MIN_PARAGRAPH_WORDS = 15

    Finding = Data.define(:reviewer_key, :question_id, :scope, :paragraph_index, :paragraph_text, :quote, :quote_offset, :probability)

    def initialize(reviewer, judge: CompoundWriting.judge)
      @reviewer = reviewer
      @judge = judge
    end

    def call(index:, kind:, text:)
      text = text.to_s
      sentences = Segmenter.sentences(text)
      plan = build_plan(kind, text, sentences)
      return [] if plan.empty?

      probabilities = @judge.judge(state: { paragraph: text }, nouls: plan.map(&:first))
      findings(index, text, plan, probabilities)
    end

    private

    attr_reader :reviewer

    def build_plan(kind, text, sentences)
      plan = []
      reviewer.questions.each do |question|
        case question.scope
        when "phrase"
          sentences.each do |sentence|
            Segmenter.ngrams(sentence.text).each do |gram|
              plan << [ Prompts.phrase(question, reviewer, gram.text), { question:, sentence:, gram: } ]
            end
          end
        when "sentence"
          next if kind == "heading"

          sentences.each { |sentence| plan << [ Prompts.sentence(question, reviewer, sentence.text), { question:, sentence: } ] }
        when "paragraph"
          next if kind == "heading" || Segmenter.word_count(text) < MIN_PARAGRAPH_WORDS

          plan << [ Prompts.paragraph(question, reviewer, text), { question: } ]
        end
      end
      plan
    end

    def findings(index, text, plan, probabilities)
      results = []
      phrase_groups = Hash.new { |hash, key| hash[key] = [] }
      plan.each_with_index do |(_noul, meta), position|
        probability = probabilities.fetch(position)
        question = meta[:question]
        if meta[:gram]
          phrase_groups[[ question.id, meta[:sentence].offset ]] << [ meta, Selection::Candidate.new(gram: meta[:gram], probability:) ]
        elsif probability >= question.threshold
          results << finding(question, index, text, meta[:sentence], probability)
        end
      end
      phrase_groups.each_value do |entries|
        by_gram = entries.to_h { |meta, candidate| [ candidate.gram, meta ] }
        question = entries.first.first[:question]
        Selection.phrases(entries.map(&:last), threshold: question.threshold).each do |candidate|
          meta = by_gram.fetch(candidate.gram)
          results << Finding.new(
            reviewer_key: reviewer.key, question_id: question.id, scope: "phrase", paragraph_index: index, paragraph_text: text,
            quote: candidate.gram.text, quote_offset: meta[:sentence].offset + candidate.gram.offset, probability: candidate.probability
          )
        end
      end
      results.sort_by { |finding| [ finding.quote_offset || -1, finding.scope ] }
    end

    def finding(question, index, text, sentence, probability)
      Finding.new(
        reviewer_key: reviewer.key, question_id: question.id, scope: question.scope, paragraph_index: index, paragraph_text: text,
        quote: sentence&.text || text, quote_offset: sentence&.offset || 0, probability:
      )
    end
  end
end
