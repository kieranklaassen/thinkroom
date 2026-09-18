# Compound writing mode: the Compound Writing reviewers (EveryInc/compound-writing)
# asked as yes/no questions of TypeSafe's Jev model over every phrase, sentence,
# and paragraph of a document, Jevgram-style (EveryInc/jevgram).
#
# Configuration is environment-only. TYPESAFE_API_KEY turns the mode on;
# COMPOUND_WRITING_FAKE_JUDGE=1 substitutes a deterministic lexicon judge so
# development, tests, and the browser check exercise the full loop offline.
# Production never runs the fake.
module CompoundWriting
  DEFAULT_MODEL = "jev-latest"

  class JudgeError < StandardError
    attr_reader :reviewer_key

    def initialize(message, reviewer_key: nil)
      @reviewer_key = reviewer_key
      super(message)
    end
  end

  module_function

  def enabled?(env: ENV)
    fake_judge?(env:) || env["TYPESAFE_API_KEY"].present?
  end

  def fake_judge?(env: ENV)
    !Rails.env.production? && env["COMPOUND_WRITING_FAKE_JUDGE"] == "1"
  end

  def model(env: ENV)
    env["TYPESAFE_MODEL"].presence || DEFAULT_MODEL
  end

  # The collaborator every reviewer job calls. Tests swap it with `judge=`.
  def judge
    @judge || (fake_judge? ? FakeJudge.new : Judge.new)
  end

  def judge=(judge)
    @judge = judge
  end
end
