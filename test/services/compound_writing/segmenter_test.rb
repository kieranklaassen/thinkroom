require "test_helper"

class CompoundWriting::SegmenterTest < ActiveSupport::TestCase
  Segmenter = CompoundWriting::Segmenter

  test "sentences split on terminal punctuation and keep offsets" do
    sentences = Segmenter.sentences("Dr. Smith left. She stayed! Did \"they\" go? Yes.")

    assert_equal [ "Dr. Smith left.", "She stayed!", "Did \"they\" go?", "Yes." ], sentences.map(&:text)
    assert_equal [ 0, 16, 28, 43 ], sentences.map(&:offset)
  end

  test "a heading or a sentence without terminal punctuation is one sentence" do
    assert_equal [ "Why we ship on Fridays" ], Segmenter.sentences("Why we ship on Fridays").map(&:text)
    assert_equal [], Segmenter.sentences("   ")
  end

  test "lowercase continuations such as e.g. do not split" do
    sentences = Segmenter.sentences("Use plain words, e.g. use instead of utilize. Next sentence.")

    assert_equal 2, sentences.size
  end

  test "ngrams run one to three words and never cross a comma or dash" do
    grams = Segmenter.ngrams("We should utilize the report, then leverage it - fast.")

    assert_includes grams.map(&:text), "utilize the report"
    assert_not_includes grams.map(&:text), "report, then"
    assert_not_includes grams.map(&:text), "it - fast"
    utilize = grams.find { |gram| gram.text == "utilize" }
    assert_equal 10, utilize.offset
    assert_equal 2, utilize.first_word
    assert_equal 1, utilize.n
  end

  test "word_count counts words not punctuation" do
    assert_equal 4, Segmenter.word_count("Hello, world; it's done.")
  end
end
