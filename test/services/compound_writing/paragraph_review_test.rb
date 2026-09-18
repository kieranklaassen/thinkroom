require "test_helper"

class CompoundWriting::ParagraphReviewTest < ActiveSupport::TestCase
  LONG = "We should utilize the report to leverage synergies. Moreover, the landscape is robust and seamless for everyone who reads it today."

  def review(key) = CompoundWriting::ParagraphReview.new(CompoundWriting::Reviewers.find!(key), judge: CompoundWriting::FakeJudge.new)

  test "a paragraph yields phrase, sentence, and paragraph findings with paragraph offsets" do
    findings = review("ai_check").call(index: 3, kind: "paragraph", text: LONG)

    phrases = findings.select { |finding| finding.scope == "phrase" }
    assert_equal %w[utilize leverage Moreover landscape robust seamless], phrases.map(&:quote)
    assert_equal LONG.index("leverage"), phrases[1].quote_offset
    assert phrases.all? { |finding| finding.probability == 0.9 && finding.paragraph_index == 3 && finding.paragraph_text == LONG }

    sentences = findings.select { |finding| finding.scope == "sentence" }
    assert_equal [ 0, LONG.index("Moreover") ], sentences.map(&:quote_offset)

    paragraph = findings.find { |finding| finding.scope == "paragraph" }
    assert_equal "overcompletion", paragraph.question_id
    assert_equal LONG, paragraph.quote
  end

  test "headings receive phrase questions only" do
    findings = review("ai_check").call(index: 0, kind: "heading", text: "Leverage the robust landscape")

    assert_equal %w[phrase], findings.map(&:scope).uniq
  end

  test "short paragraphs skip paragraph-scope questions" do
    findings = review("ai_check").call(index: 0, kind: "paragraph", text: "Robust and seamless.")

    assert_not_includes findings.map(&:scope), "paragraph"
    assert_includes findings.map(&:scope), "phrase"
  end

  test "a reviewer without a hit makes no findings and an empty paragraph asks nothing" do
    judge = Class.new do
      attr_reader :calls
      def judge(state:, nouls:)
        (@calls ||= []) << nouls.size
        Array.new(nouls.size, 0.1)
      end
    end.new
    reviewer = CompoundWriting::Reviewers.find!("hemingway")

    assert_empty CompoundWriting::ParagraphReview.new(reviewer, judge:).call(index: 0, kind: "paragraph", text: "Plain words.")
    assert_empty CompoundWriting::ParagraphReview.new(reviewer, judge:).call(index: 1, kind: "paragraph", text: "   ")
    assert_equal 1, judge.calls.size
  end

  test "text review answers whole-text questions without an anchor" do
    findings = CompoundWriting::TextReview.new(CompoundWriting::Reviewers.find!("bluf"), judge: CompoundWriting::FakeJudge.new)
                                            .call([ { "text" => "Ultimately, the bottom line is late." }, { "text" => "More." } ])

    assert_equal [ "lede" ], findings.map(&:question_id)
    assert_nil findings.first.paragraph_index
    assert_equal "text", findings.first.scope
  end
end
