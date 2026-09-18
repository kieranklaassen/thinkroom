module CompoundWriting
  # Estimates, before anything is enqueued, how many Noul questions and how
  # many TypeSafe requests a pass would cost, using the same segmentation and
  # batching rules the jobs apply. WritingPass.start! refuses a pass over
  # Limits.max_nouls_per_pass or Limits.max_jev_calls_per_pass, so one
  # document can never fan out into an unbounded number of HTTP calls.
  module PassBudget
    Estimate = Data.define(:nouls, :calls) do
      def over?(env: ENV)
        nouls > Limits.max_nouls_per_pass(env:) || calls > Limits.max_jev_calls_per_pass(env:)
      end
    end

    class Exceeded < StandardError; end

    module_function

    # paragraphs: the normalised [{ "kind", "text" }] list; reviewers: Reviewer structs.
    def estimate(paragraphs, reviewers)
      shapes = paragraphs.map { |paragraph| shape(paragraph) }
      nouls = 0
      calls = 0
      reviewers.each do |reviewer|
        counts = reviewer.questions.group_by(&:scope).transform_values(&:size)
        shapes.each do |shape|
          per_paragraph = counts.fetch("phrase", 0) * shape[:grams] +
            (shape[:heading] ? 0 : counts.fetch("sentence", 0) * shape[:sentences]) +
            (shape[:heading] || shape[:words] < ParagraphReview::MIN_PARAGRAPH_WORDS ? 0 : counts.fetch("paragraph", 0))
          next if per_paragraph.zero?

          nouls += per_paragraph
          calls += (per_paragraph / Judge::MAX_NOULS_PER_REQUEST.to_f).ceil
        end
        text_questions = counts.fetch("text", 0)
        if text_questions.positive? && shapes.any?
          nouls += text_questions
          calls += 1
        end
      end
      Estimate.new(nouls:, calls:)
    end

    def check!(paragraphs, reviewers, env: ENV)
      estimate = estimate(paragraphs, reviewers)
      return estimate unless estimate.over?(env:)

      raise Exceeded, "This run would ask about #{estimate.nouls.to_fs(:delimited)} passages in #{estimate.calls.to_fs(:delimited)} requests; " \
                      "the limit is #{Limits.max_nouls_per_pass(env:).to_fs(:delimited)} passages or #{Limits.max_jev_calls_per_pass(env:).to_fs(:delimited)} requests. " \
                      "Switch off some reviewers or review a shorter document."
    end

    def shape(paragraph)
      text = paragraph["text"].to_s
      sentences = Segmenter.sentences(text)
      {
        heading: paragraph["kind"] == "heading",
        words: Segmenter.word_count(text),
        sentences: sentences.size,
        grams: sentences.sum { |sentence| Segmenter.ngrams(sentence.text).size }
      }
    end
    private_class_method :shape
  end
end
