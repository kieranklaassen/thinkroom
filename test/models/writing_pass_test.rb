require "test_helper"

class WritingPassTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper
  include ActionCable::TestHelper

  PARAGRAPHS = [
    { index: 0, kind: "heading", text: "Leverage the report" },
    { index: 1, kind: "paragraph", text: "We should utilize the report to leverage synergies across the whole team this quarter." }
  ].freeze

  setup { @document = Document.create!(title: "Doc") }

  test "start! creates a queued pass, one queued run per reviewer, an activity, and one job per reviewer" do
    pass = nil
    assert_enqueued_jobs 2, only: WritingReviewerJob do
      assert_difference -> { @document.activities.count }, 1 do
        pass = WritingPass.start!(document: @document, requested_by_name: "Quiet Falcon", reviewer_keys: %w[hemingway ai_check hemingway], paragraphs: PARAGRAPHS)
      end
    end

    assert_equal "queued", pass.status
    assert_equal %w[hemingway ai_check], pass.reviewer_keys
    assert_equal({ "hemingway" => { "status" => "queued" }, "ai_check" => { "status" => "queued" } }, pass.reviewer_runs)
    assert_equal 2, pass.paragraphs.size
    assert_equal 17, pass.word_count
    activity = @document.activities.last
    assert_equal "ran_writing_reviewers", activity.action
    assert_equal "Hemingway and AI check", activity.detail
  end

  def start(keys: %w[mom], paragraphs: PARAGRAPHS, now: Time.current)
    WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: keys, paragraphs:, now:)
  end

  def finish(pass, at: Time.current)
    pass.reviewer_keys.each { |key| pass.record_run!(key, status: "finished", findings_count: 0) }
    pass.update!(finished_at: at, created_at: at - 1.second)
    pass
  end

  def after_cooldown = Time.current + CompoundWriting::Limits.cooldown_seconds + 1

  test "start! replaces the document's finished pass and its findings after the cooldown" do
    old = finish(start)
    old.findings.create!(document: @document, reviewer_key: "mom", question_id: "insider", scope: "sentence", probability: 0.9)

    fresh = start(keys: %w[nemesis], now: after_cooldown)

    assert_equal [ fresh ], @document.writing_passes.reload.to_a
    assert_equal 0, WritingFinding.where(document: @document).count
  end

  test "start! refuses to replace a pass that is still running until it has stalled" do
    running = start

    error = assert_raises(WritingPass::Throttled) { start(keys: %w[nemesis], now: Time.current + 30) }
    assert_match(/already running/, error.message)
    assert_equal [ running ], @document.writing_passes.reload.to_a

    stalled = start(keys: %w[nemesis], now: Time.current + CompoundWriting::Limits.stall_seconds + 1)
    assert_equal [ stalled ], @document.writing_passes.reload.to_a
  end

  test "start! enforces a cooldown between passes on one document" do
    finish(start)

    error = assert_raises(WritingPass::Throttled) { start(keys: %w[nemesis], now: Time.current + 10) }
    assert_match(/Wait \d+ more seconds? before running/, error.message)

    assert_nothing_raised { start(keys: %w[nemesis], now: after_cooldown) }
  end

  test "start! returns the finished pass unchanged when text and reviewers repeat" do
    finished = finish(start)

    error = assert_raises(WritingPass::Unchanged) { start(now: after_cooldown) }
    assert_equal finished, error.pass
    assert_equal [ finished ], @document.writing_passes.reload.to_a

    changed_text = PARAGRAPHS.map { |paragraph| paragraph.merge(text: "#{paragraph[:text]} And more.") }
    assert_nothing_raised { start(paragraphs: changed_text, now: after_cooldown) }
  end

  test "start! records the estimated spend and refuses a pass over the question budget" do
    pass = start

    assert pass.estimated_nouls.positive?
    assert pass.estimated_calls.positive?
    assert_equal CompoundWriting::ParagraphDigest.of(PARAGRAPHS.map { |paragraph| paragraph[:text] }), pass.paragraphs_digest

    finish(pass)
    with_env("COMPOUND_WRITING_MAX_NOULS_PER_PASS" => "3") do
      error = assert_raises(CompoundWriting::PassBudget::Exceeded) { start(keys: %w[ai_check], now: after_cooldown) }
      assert_match(/the limit is 3 passages/, error.message)
    end
    with_env("COMPOUND_WRITING_MAX_JEV_CALLS_PER_PASS" => "1") do
      assert_raises(CompoundWriting::PassBudget::Exceeded) { start(keys: %w[ai_check], now: after_cooldown) }
    end
    assert_equal [ pass ], @document.writing_passes.reload.to_a
  end

  def with_env(values)
    previous = ENV.to_h.slice(*values.keys)
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    values.each_key { |key| ENV.delete(key) }
    ENV.update(previous)
  end

  test "start! refuses unknown reviewers, no reviewers, and oversized documents" do
    assert_raises(ArgumentError) { WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[nope], paragraphs: PARAGRAPHS) }
    assert_raises(ArgumentError) { WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: [], paragraphs: PARAGRAPHS) }
    long = [ { text: (%w[word] * (WritingPass::MAX_WORDS + 1)).join(" ") } ]
    assert_raises(WritingPass::TooLarge) { WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[mom], paragraphs: long) }
    many = Array.new(WritingPass::MAX_PARAGRAPHS + 1) { { text: "one" } }
    assert_raises(WritingPass::TooLarge) { WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[mom], paragraphs: many) }
    assert_empty @document.writing_passes
  end

  test "prepare_paragraphs drops blanks, defaults kinds, and keeps the client's indexes" do
    paragraphs, words = WritingPass.prepare_paragraphs([ { "index" => 4, "kind" => "code", "text" => "a b" }, { "text" => " " }, { "index" => 7, "kind" => "heading", "text" => "H" } ])

    assert_equal [ { "index" => 4, "kind" => "paragraph", "text" => "a b" }, { "index" => 7, "kind" => "heading", "text" => "H" } ], paragraphs
    assert_equal 3, words
  end

  test "record_run! merges entries under lock and derives the pass status" do
    pass = WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[mom nemesis], paragraphs: PARAGRAPHS)

    pass.record_run!("mom", status: "running")
    assert_equal "running", pass.reload.status

    pass.record_run!("mom", status: "finished", findings_count: 3)
    assert_equal "running", pass.reload.status
    assert_equal 3, pass.reviewer_runs["mom"]["findings_count"]
    assert pass.reviewer_runs["mom"]["finished_at"].present?
    assert_equal "queued", pass.reviewer_runs["nemesis"]["status"]

    pass.record_run!("nemesis", status: "failed", error: "RateLimitError: slow down")
    pass.reload
    assert_equal "finished", pass.status
    assert pass.finished_at.present?
    assert_equal "RateLimitError: slow down", pass.reviewer_runs["nemesis"]["error"]
  end

  test "a pass whose every reviewer failed is failed" do
    pass = WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[mom], paragraphs: PARAGRAPHS)
    pass.record_run!("mom", status: "failed", error: "boom")

    assert_equal "failed", pass.reload.status
  end

  test "as_props lists active findings in document order with the question note" do
    pass = WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[ai_check], paragraphs: PARAGRAPHS)
    later = pass.findings.create!(document: @document, reviewer_key: "ai_check", question_id: "vocabulary", scope: "phrase", paragraph_index: 1, paragraph_text: "p", quote: "leverage", quote_offset: 30, probability: 0.91)
    pass.findings.create!(document: @document, reviewer_key: "ai_check", question_id: "vocabulary", scope: "phrase", paragraph_index: 1, paragraph_text: "p", quote: "utilize", quote_offset: 10, probability: 0.9)
    later.dismiss!

    props = pass.reload.as_props
    assert_equal [ "utilize" ], props[:findings].map { |finding| finding[:quote] }
    assert_equal "Stock AI vocabulary or template", props[:findings].first[:note]
    assert_equal 2, props[:paragraph_count]
  end

  test "dismiss! broadcasts a writing_pass event once" do
    pass = WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[ai_check], paragraphs: PARAGRAPHS)
    finding = pass.findings.create!(document: @document, reviewer_key: "ai_check", question_id: "vocabulary", scope: "phrase", probability: 0.9)

    assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 1) { finding.dismiss! }
    assert finding.reload.dismissed_at.present?
  end
end
