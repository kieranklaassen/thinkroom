module CompoundWriting
  # Every knob that bounds what one document, one address, or one process can
  # spend against the shared TypeSafe key. Defaults are deliberately generous
  # for a writer and tight for abuse; each reads its ENV override live so a
  # deployment can tune it without a code change (see DEPLOYING.md).
  module Limits
    DEFAULTS = {
      # Seconds a document must wait between two passes.
      "COMPOUND_WRITING_COOLDOWN_SECONDS" => 60,
      # A pass still queued/running after this many seconds is treated as
      # abandoned (a restart on the in-process adapter) and may be replaced.
      "COMPOUND_WRITING_STALL_SECONDS" => 600,
      # Passes one document may start per day.
      "COMPOUND_WRITING_DOCUMENT_DAILY_PASSES" => 40,
      # Passes one client address may start per day, across documents.
      "COMPOUND_WRITING_IP_DAILY_PASSES" => 100,
      # Noul questions one pass may ask in total, across its reviewers.
      "COMPOUND_WRITING_MAX_NOULS_PER_PASS" => 20_000,
      # TypeSafe HTTP requests one pass may make in total (estimated up front).
      "COMPOUND_WRITING_MAX_JEV_CALLS_PER_PASS" => 1_500,
      # TypeSafe requests in flight at once from this process, all passes.
      "COMPOUND_WRITING_MAX_CONCURRENT_JEV_CALLS" => 4
    }.freeze

    module_function

    def fetch(name, env: ENV)
      default = DEFAULTS.fetch(name)
      value = Integer(env[name].to_s, exception: false)
      value.nil? || value <= 0 ? default : value
    end

    def cooldown_seconds(env: ENV) = fetch("COMPOUND_WRITING_COOLDOWN_SECONDS", env:)
    def stall_seconds(env: ENV) = fetch("COMPOUND_WRITING_STALL_SECONDS", env:)
    def document_daily_passes(env: ENV) = fetch("COMPOUND_WRITING_DOCUMENT_DAILY_PASSES", env:)
    def ip_daily_passes(env: ENV) = fetch("COMPOUND_WRITING_IP_DAILY_PASSES", env:)
    def max_nouls_per_pass(env: ENV) = fetch("COMPOUND_WRITING_MAX_NOULS_PER_PASS", env:)
    def max_jev_calls_per_pass(env: ENV) = fetch("COMPOUND_WRITING_MAX_JEV_CALLS_PER_PASS", env:)
    def max_concurrent_jev_calls(env: ENV) = fetch("COMPOUND_WRITING_MAX_CONCURRENT_JEV_CALLS", env:)
  end
end
