module CompoundWriting
  # Turns Jev's probabilities into the spans worth showing. Phrase candidates
  # from one sentence compete: the best non-overlapping n-grams win, with a
  # small penalty per extra word so "utilize" beats "can utilize" when Jev
  # scores the containing phrase almost as high as the hit itself (Jevgram's
  # shortness bias). Sentence, paragraph, and text candidates only face the
  # threshold.
  module Selection
    SHORTNESS_BIAS = 0.02

    Candidate = Data.define(:gram, :probability) do
      def adjusted = probability - SHORTNESS_BIAS * (gram.n - 1)
    end

    module_function

    # candidates: Array<Candidate> from one sentence and one question.
    # Returns the flagged candidates in document order.
    def phrases(candidates, threshold:)
      used = Set.new
      picks = []
      candidates.sort_by { |candidate| [ -candidate.adjusted, candidate.gram.n ] }.each do |candidate|
        span = (candidate.gram.first_word...(candidate.gram.first_word + candidate.gram.n)).to_a
        next if span.any? { |index| used.include?(index) }

        used.merge(span)
        picks << candidate
      end
      picks.select { |candidate| candidate.probability >= threshold }.sort_by { |candidate| candidate.gram.offset }
    end
  end
end
