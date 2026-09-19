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

  # The account gate: compound writing exists only for signed-in accounts
  # holding the feature (Features::COMPOUND_WRITING). Independent of whether a
  # judge is configured, so a featured account still sees the panel and its
  # not-configured notice.
  def available_to?(user)
    user.present? && user.feature?(Features::COMPOUND_WRITING)
  end

  # Hands ruby_llm-skills' marketplace layer the token and caps before a
  # fetch. GITHUB_TOKEN is the gem's own default; MARKETPLACE_GITHUB_TOKEN
  # overrides it for deployments that keep a dedicated read token.
  def configure_marketplaces!(env: ENV)
    RubyLLM::Skills::Marketplace.configure do |config|
      config.github_token = env["MARKETPLACE_GITHUB_TOKEN"].presence || env["GITHUB_TOKEN"].presence
      config.max_archive_bytes = 32 * 1024 * 1024
      config.max_file_bytes = 4 * 1024 * 1024
      config.max_files = 2_000
      config.max_skills = 200
      config.user_agent = "thinkroom-compound-writing (+https://github.com/kieranklaassen/thinkroom)"
    end
  end
end
