require "test_helper"

class CompoundWriting::ReviewersTest < ActiveSupport::TestCase
  test "every reviewer is complete and distinct" do
    reviewers = CompoundWriting::Reviewers.all

    assert_equal reviewers.map(&:key).uniq, reviewers.map(&:key)
    assert_equal reviewers.map(&:color).uniq, reviewers.map(&:color)
    reviewers.each do |reviewer|
      assert reviewer.questions.any?, "#{reviewer.key} has no questions"
      assert_equal reviewer.questions.map(&:id).uniq, reviewer.questions.map(&:id), "#{reviewer.key} repeats a question id"
      assert reviewer.lexicon.any?, "#{reviewer.key} has no fake-judge lexicon"
      assert reviewer.source.start_with?("skills/cw-"), "#{reviewer.key} lacks a compound-writing source"
      reviewer.questions.each do |question|
        assert_includes CompoundWriting::Reviewers::SCOPES, question.scope
        assert question.question.end_with?("?"), "#{reviewer.key}.#{question.id} is not a question"
        assert question.threshold.between?(0.05, 0.95)
      end
    end
  end

  test "props expose the client-facing shape without the questions' prose" do
    props = CompoundWriting::Reviewers.as_props.first

    assert_equal %i[key name blurb color source questions], props.keys
    assert_equal %i[id scope note], props[:questions].first.keys
  end

  test "normalize_keys validates and deduplicates keys" do
    assert_equal %w[hemingway mom], CompoundWriting::Reviewers.normalize_keys(%w[hemingway mom hemingway])
    assert_raises(ArgumentError) { CompoundWriting::Reviewers.normalize_keys(%w[hemingway nope]) }
  end

  test "an unknown scope is rejected at definition time" do
    assert_raises(ArgumentError) do
      CompoundWriting::Reviewers::Question.new(id: "x", scope: "word", question: "Is it?", note: "n")
    end
  end
end
