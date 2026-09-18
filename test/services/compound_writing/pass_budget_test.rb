require "test_helper"

class CompoundWriting::PassBudgetTest < ActiveSupport::TestCase
  PARAGRAPHS = [
    { "kind" => "heading", "text" => "Leverage the report" },
    { "kind" => "paragraph", "text" => "We should utilize the report to leverage synergies across the whole team this quarter, obviously." }
  ].freeze

  def reviewer(key) = CompoundWriting::Reviewers.find!(key)

  test "estimates one noul per gram, sentence, paragraph, and text question, batched per request" do
    estimate = CompoundWriting::PassBudget.estimate(PARAGRAPHS, [ reviewer("ai_check") ])

    heading_grams = CompoundWriting::Segmenter.ngrams("Leverage the report").size
    body_grams = CompoundWriting::Segmenter.ngrams(PARAGRAPHS[1]["text"]).size
    # heading: phrase question only; body: phrase grams + 1 sentence + 1 paragraph question; no text question.
    assert_equal heading_grams + body_grams + 1 + 1, estimate.nouls
    assert_equal 2, estimate.calls
  end

  test "text-scope questions add one request per reviewer with content" do
    estimate = CompoundWriting::PassBudget.estimate(PARAGRAPHS, [ reviewer("bluf") ])

    # bluf: one paragraph question (body only, heading skipped) and one text question.
    assert_equal 2, estimate.nouls
    assert_equal 2, estimate.calls
    assert_equal 0, CompoundWriting::PassBudget.estimate([], [ reviewer("bluf") ]).calls
  end

  test "check! passes under the limits and raises a readable message over them" do
    assert_nothing_raised { CompoundWriting::PassBudget.check!(PARAGRAPHS, [ reviewer("ai_check") ]) }

    error = assert_raises(CompoundWriting::PassBudget::Exceeded) do
      CompoundWriting::PassBudget.check!(PARAGRAPHS, [ reviewer("ai_check") ], env: { "COMPOUND_WRITING_MAX_NOULS_PER_PASS" => "5" })
    end
    assert_match(/would ask about \d+ passages in 2 requests; the limit is 5 passages or 1,500 requests/, error.message)
  end

  test "limits read their environment overrides live and fall back on junk" do
    assert_equal 20_000, CompoundWriting::Limits.max_nouls_per_pass(env: {})
    assert_equal 7, CompoundWriting::Limits.max_nouls_per_pass(env: { "COMPOUND_WRITING_MAX_NOULS_PER_PASS" => "7" })
    assert_equal 60, CompoundWriting::Limits.cooldown_seconds(env: { "COMPOUND_WRITING_COOLDOWN_SECONDS" => "nope" })
    assert_equal 4, CompoundWriting::Limits.max_concurrent_jev_calls(env: { "COMPOUND_WRITING_MAX_CONCURRENT_JEV_CALLS" => "0" })
  end
end
