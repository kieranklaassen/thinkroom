# RubyLLM drives one thing in Thinkroom: the compound writing mode's calls to
# TypeSafe's Jev model (see CompoundWriting). Every setting comes from the
# environment so the app boots, and the test suite runs, with no key at all;
# CompoundWriting.enabled? is the switch the UI and controllers read.
module RubyLlmSettings
  module_function

  def apply(config, env: ENV)
    config.typesafe_api_key = env["TYPESAFE_API_KEY"].presence
    config.typesafe_api_base = env["TYPESAFE_API_BASE"].presence if env["TYPESAFE_API_BASE"].present?
    # One Jev request carries up to a couple of hundred questions; give it
    # room, and let RubyLLM retry 429/529 with backoff (TypeSafe asks for it).
    config.request_timeout = Integer(env.fetch("TYPESAFE_TIMEOUT_SECONDS", "60"))
    config.max_retries = 2
    config
  end
end

RubyLLM.configure { |config| RubyLlmSettings.apply(config) }
