require "test_helper"

class CompoundWriting::SelectionTest < ActiveSupport::TestCase
  Gram = CompoundWriting::Segmenter::Gram
  Candidate = CompoundWriting::Selection::Candidate

  def candidate(text, offset, first_word, n, probability)
    Candidate.new(gram: Gram.new(text:, offset:, first_word:, n:), probability:)
  end

  test "the shortness bias lets the hit beat the phrase that contains it" do
    picks = CompoundWriting::Selection.phrases(
      [ candidate("can utilize", 4, 1, 2, 0.91), candidate("utilize", 8, 2, 1, 0.90), candidate("can", 4, 1, 1, 0.2) ],
      threshold: 0.7
    )

    assert_equal [ "utilize" ], picks.map { |pick| pick.gram.text }
  end

  test "picks never overlap and come back in document order" do
    picks = CompoundWriting::Selection.phrases(
      [ candidate("very", 0, 0, 1, 0.8), candidate("very quickly", 0, 0, 2, 0.75), candidate("quickly", 5, 1, 1, 0.72), candidate("ran", 13, 2, 1, 0.9) ],
      threshold: 0.7
    )

    assert_equal [ "very", "quickly", "ran" ], picks.map { |pick| pick.gram.text }
  end

  test "candidates under the threshold are dropped after selection" do
    picks = CompoundWriting::Selection.phrases([ candidate("plain", 0, 0, 1, 0.3) ], threshold: 0.7)

    assert_empty picks
  end
end
