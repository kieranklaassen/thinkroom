require "test_helper"

class CompoundWriting::JudgeTest < ActiveSupport::TestCase
  # Stands in for RubyLLM::Chat: records each schema + state and answers from a script.
  class ChatDouble
    attr_reader :requests

    def initialize(answers: nil, error: nil)
      @answers = answers
      @error = error
      @requests = []
    end

    def with_schema(schema)
      @schema = schema
      self
    end

    def ask(state)
      @requests << { ids: @schema.ids, questions: @schema.questions, state: JSON.parse(state) }
      raise @error if @error

      Struct.new(:parsed).new(@answers.call(@schema.ids))
    end
  end

  def reviewer = CompoundWriting::Reviewers.find!("ai_check")
  def question = reviewer.question("vocabulary")

  def nouls(count)
    Array.new(count) { |index| CompoundWriting::Prompts.phrase(question, reviewer, "phrase #{index}") }
  end

  test "asks q0..qN over the state and returns probabilities in order" do
    chat = ChatDouble.new(answers: ->(ids) { ids.to_h { |id| [ id, { "type" => "noul", "noul" => id.delete_prefix("q").to_f / 10 } ] } })

    probabilities = CompoundWriting::Judge.new(chat:).judge(state: { paragraph: "A paragraph." }, nouls: nouls(3))

    assert_equal [ 0.0, 0.1, 0.2 ], probabilities
    request = chat.requests.first
    assert_equal %w[q0 q1 q2], request[:ids]
    assert_equal({ "paragraph" => "A paragraph." }, request[:state])
    assert_match(/exact phrase "phrase 1"/, request[:questions]["q1"]["instructions"])
  end

  test "splits a long list into requests under the noul cap and keeps alignment" do
    chat = ChatDouble.new(answers: ->(ids) { ids.to_h { |id| [ id, { "type" => "noul", "noul" => 0.5 } ] } })

    probabilities = CompoundWriting::Judge.new(chat:).judge(state: { paragraph: "x" }, nouls: nouls(250))

    assert_equal 250, probabilities.size
    assert_equal [ 200, 50 ], chat.requests.map { |request| request[:ids].size }
  end

  test "an empty list makes no request" do
    chat = ChatDouble.new(answers: ->(_) { {} })

    assert_equal [], CompoundWriting::Judge.new(chat:).judge(state: {}, nouls: [])
    assert_empty chat.requests
  end

  test "a provider failure becomes a JudgeError naming the reviewer" do
    chat = ChatDouble.new(error: RubyLLM::RateLimitError.new("slow down"))

    error = assert_raises(CompoundWriting::JudgeError) do
      CompoundWriting::Judge.new(chat:).judge(state: { paragraph: "x" }, nouls: nouls(1))
    end
    assert_equal "ai_check", error.reviewer_key
    assert_match(/RateLimitError/, error.message)
  end

  test "an answer map missing a question is a JudgeError" do
    chat = ChatDouble.new(answers: ->(_) { { "q0" => { "type" => "noul", "noul" => 0.2 } } })

    assert_raises(CompoundWriting::JudgeError) do
      CompoundWriting::Judge.new(chat:).judge(state: { paragraph: "x" }, nouls: nouls(2))
    end
  end

  test "in-flight requests share one process-wide slot limit" do
    limit = CompoundWriting::Limits.max_concurrent_jev_calls
    active = Concurrent::AtomicFixnum.new(0)
    peak = Concurrent::AtomicFixnum.new(0)
    threads = Array.new(limit * 3) do
      Thread.new do
        CompoundWriting::Judge.with_slot do
          now = active.increment
          peak.update { |value| [ value, now ].max }
          sleep 0.02
          active.decrement
        end
      end
    end
    threads.each(&:join)

    assert_equal limit, CompoundWriting::Judge::SEMAPHORE.available_permits
    assert peak.value <= limit, "#{peak.value} requests were in flight; the limit is #{limit}"
    assert peak.value > 1, "the gate should still allow parallel requests"
  end

  test "a request releases its slot even when the provider raises" do
    chat = ChatDouble.new(error: RubyLLM::ServerError.new("boom"))
    before = CompoundWriting::Judge::SEMAPHORE.available_permits

    assert_raises(CompoundWriting::JudgeError) { CompoundWriting::Judge.new(chat:).judge(state: { paragraph: "x" }, nouls: nouls(1)) }
    assert_equal before, CompoundWriting::Judge::SEMAPHORE.available_permits
  end

  test "the fake judge flags a reviewer's lexicon and nothing else" do
    fake = CompoundWriting::FakeJudge.new
    hit = CompoundWriting::Prompts.phrase(question, reviewer, "utilize")
    miss = CompoundWriting::Prompts.phrase(question, reviewer, "the report")
    nemesis = CompoundWriting::Reviewers.find!("nemesis")
    other = CompoundWriting::Prompts.phrase(nemesis.questions.first, nemesis, "utilize")

    assert_equal [ 0.9, 0.1, 0.1 ], fake.judge(state: {}, nouls: [ hit, miss, other ])
  end
end
