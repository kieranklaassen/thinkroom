module CompoundWriting
  # A deterministic stand-in for Jev (COMPOUND_WRITING_FAKE_JUDGE=1) so the
  # whole loop runs offline: each reviewer's lexicon marks a phrase or sentence
  # that contains one of its words, and a paragraph or text that contains two
  # distinct words. Probabilities are fixed so tests and the browser check can
  # assert exact values; a real judge is never consulted.
  class FakeJudge
    PHRASE_HIT = 0.9
    SENTENCE_HIT = 0.85
    BLOCK_HIT = 0.8
    MISS = 0.1

    def judge(state:, nouls:)
      nouls.map do |noul|
        lexicon = Reviewers.find!(noul.reviewer_key).lexicon
        hits = lexicon.count { |word| noul.subject.match?(/(?<![\p{L}\p{N}])#{Regexp.escape(word)}(?![\p{L}\p{N}])/i) }
        case noul.scope
        when "phrase" then lexicon.any? { |word| word.casecmp?(noul.subject) } ? PHRASE_HIT : MISS
        when "sentence" then hits.positive? ? SENTENCE_HIT : MISS
        else hits >= 2 ? BLOCK_HIT : MISS
        end
      end
    end
  end
end
