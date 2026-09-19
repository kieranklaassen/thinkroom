require "test_helper"

class WritingReviewerJobTest < ActiveJob::TestCase
  include ActionCable::TestHelper
  include CompoundWritingHelpers

  PARAGRAPHS = [
    { index: 0, kind: "heading", text: "Leverage the report" },
    { index: 2, kind: "paragraph", text: "We should utilize the report to leverage synergies across the whole team this quarter, obviously." }
  ].freeze

  class FailingJudge
    def judge(state:, nouls:) = raise(CompoundWriting::JudgeError.new("RateLimitError: slow down", reviewer_key: nouls.first&.reviewer_key))
  end

  setup do
    @document = Document.create!(title: "Doc")
    CompoundWriting.judge = CompoundWriting::FakeJudge.new
  end

  teardown { CompoundWriting.judge = nil }

  AI = "compound-writing/cw-ai-check"
  MOM = "compound-writing/cw-mom"

  def start(*skills, now: Time.current)
    WritingPass.start!(document: @document, requested_by_name: "A", lenses: compound_lenses(*skills), paragraphs: PARAGRAPHS, now:)
  end

  # A running pass may only be replaced once it has stalled past the limit.
  def stalled = Time.current + CompoundWriting::Limits.stall_seconds + 1

  test "persists the reviewer's findings with paragraph anchors and finishes its run" do
    pass = start("cw-ai-check", "cw-mom")

    WritingReviewerJob.perform_now(pass.id, AI)

    findings = pass.findings.where(reviewer_key: AI).order(:paragraph_index, :quote_offset)
    assert_equal [ [ 0, "Leverage", 0 ], [ 2, "utilize", 10 ], [ 2, "leverage", 32 ] ], findings.where(scope: "phrase").map { |finding| [ finding.paragraph_index, finding.quote, finding.quote_offset ] }
    assert_equal PARAGRAPHS[1][:text], findings.find_by(quote: "utilize").paragraph_text
    assert findings.where(scope: "sentence").exists?, "the fake judge flags the sentence with a lexicon hit"
    assert findings.where(scope: "paragraph").exists?, "two distinct lexicon hits flag the paragraph"
    pass.reload
    assert_equal "finished", pass.reviewer_runs[AI]["status"]
    assert_equal findings.count, pass.reviewer_runs[AI]["findings_count"]
    assert_equal "queued", pass.reviewer_runs[MOM]["status"]
    assert_equal "running", pass.status
  end

  test "the pass finishes when the last reviewer finishes" do
    pass = start("cw-ai-check", "cw-mom")

    WritingReviewerJob.perform_now(pass.id, AI)
    WritingReviewerJob.perform_now(pass.id, MOM)

    assert_equal "finished", pass.reload.status
    assert_empty pass.findings.where(reviewer_key: MOM), "mom's lexicon does not appear in the text"
  end

  test "broadcasts as paragraphs land" do
    pass = start("cw-ai-check")

    assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 4) do
      # running, heading findings, paragraph findings, finished
      WritingReviewerJob.perform_now(pass.id, AI)
    end
  end

  test "a judge failure marks only that reviewer failed" do
    CompoundWriting.judge = FailingJudge.new
    pass = start("cw-ai-check", "cw-mom")

    WritingReviewerJob.perform_now(pass.id, AI)

    pass.reload
    assert_equal "failed", pass.reviewer_runs[AI]["status"]
    assert_equal "RateLimitError: slow down", pass.reviewer_runs[AI]["error"]
    assert_equal "queued", pass.reviewer_runs[MOM]["status"]
    assert_equal "running", pass.status
  end

  test "a job for a replaced pass exits without raising or broadcasting" do
    old = start("cw-ai-check")
    start("cw-ai-check", now: stalled)

    assert_no_broadcasts(DocumentMetaChannel.broadcasting_for(@document)) do
      WritingReviewerJob.perform_now(old.id, AI)
    end
  end

  test "a pass replaced mid-run stops asking the judge and leaves no rows behind" do
    pass = start("cw-ai-check")
    fresh = nil
    mom = compound_lenses("cw-mom")
    document = pass.document
    replacing_judge = Object.new
    replacing_judge.define_singleton_method(:judge) do |state:, nouls:|
      fresh ||= WritingPass.start!(document:, requested_by_name: "B", lenses: mom, paragraphs: PARAGRAPHS,
                                   now: Time.current + CompoundWriting::Limits.stall_seconds + 1)
      Array.new(nouls.size, 0.9)
    end
    CompoundWriting.judge = replacing_judge

    assert_nothing_raised { WritingReviewerJob.perform_now(pass.id, AI) }

    assert_not WritingPass.exists?(pass.id)
    assert_empty WritingFinding.where(document: @document)
    assert_equal "queued", fresh.reload.reviewer_runs[MOM]["status"]
  end

  test "an unexpected error marks the reviewer failed instead of leaving it running" do
    crashing_judge = Object.new
    crashing_judge.define_singleton_method(:judge) { |state:, nouls:| raise NoMethodError, "undefined method for nil" }
    CompoundWriting.judge = crashing_judge
    pass = start("cw-ai-check")

    assert_nothing_raised { WritingReviewerJob.perform_now(pass.id, AI) }

    run = pass.reload.reviewer_runs[AI]
    assert_equal "failed", run["status"]
    assert_match(/NoMethodError/, run["error"])
    assert_equal "failed", pass.status
  end

  test "whole-text questions land as text findings" do
    document = Document.create!(title: "Doc")
    pass = WritingPass.start!(document:, requested_by_name: "A", lenses: compound_lenses("cw-bluf"), paragraphs: [ { text: "Ultimately, the bottom line matters here." } ])

    WritingReviewerJob.perform_now(pass.id, "compound-writing/cw-bluf")

    finding = pass.findings.find_by(scope: "text")
    assert_equal "lede", finding.question_id
    assert_nil finding.paragraph_index
  end
end
