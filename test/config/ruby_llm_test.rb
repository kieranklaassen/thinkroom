require "test_helper"

class RubyLlmTest < ActiveSupport::TestCase
  test "typesafe provider is registered after boot" do
    assert RubyLLM::Provider.providers.key?(:typesafe)
  end

  test "settings read the key, base, and timeout from the environment" do
    config = RubyLLM::Configuration.new
    RubyLlmSettings.apply(config, env: { "TYPESAFE_API_KEY" => "ts-test", "TYPESAFE_TIMEOUT_SECONDS" => "15" })

    assert_equal "ts-test", config.typesafe_api_key
    assert_equal 15, config.request_timeout
    assert_equal 2, config.max_retries
  end

  test "an absent key leaves the provider unconfigured" do
    config = RubyLlmSettings.apply(RubyLLM::Configuration.new, env: {})

    assert_nil config.typesafe_api_key
    assert_not RubyLLM::Provider.providers[:typesafe].configured?(config)
  end

  test "enabled? follows the key or the fake judge outside production" do
    assert_not CompoundWriting.enabled?(env: {})
    assert CompoundWriting.enabled?(env: { "TYPESAFE_API_KEY" => "ts-test" })
    assert CompoundWriting.enabled?(env: { "COMPOUND_WRITING_FAKE_JUDGE" => "1" })
    assert_not CompoundWriting.fake_judge?(env: { "COMPOUND_WRITING_FAKE_JUDGE" => "0" })
  end

  test "model defaults to jev-latest" do
    assert_equal "jev-latest", CompoundWriting.model(env: {})
    assert_equal "jev-preview", CompoundWriting.model(env: { "TYPESAFE_MODEL" => "jev-preview" })
  end
end
