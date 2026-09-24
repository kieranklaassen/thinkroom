require "test_helper"
require "open3"
require "tmpdir"

# config/deploy.yml is ERB over deploy.env. Optional string variables must
# render as YAML strings even when unset: a bare empty value is YAML nil and
# `bin/kamal config` refuses it ("env/clear/<NAME>: should be a string").
class DeployConfigTest < ActiveSupport::TestCase
  REQUIRED = {
    "KAMAL_SERVICE" => "thinkroom",
    "KAMAL_IMAGE" => "ghcr.io/example/thinkroom",
    "KAMAL_HOSTS" => "203.0.113.10",
    "KAMAL_PROXY_HOSTS" => "thinkroom.example.com",
    "KAMAL_REGISTRY_USERNAME" => "example",
    "KAMAL_STORAGE_VOLUME" => "thinkroom_storage"
  }.freeze

  OPTIONAL = %w[WEBMCP_ORIGIN_TRIAL_TOKEN RIFFREC_AUTOMATION_EMAILS THINKROOM_ADMIN_EMAILS].freeze

  def render_clear_env(overrides = {})
    env = REQUIRED.merge(overrides)
    with_env(env, cleared: OPTIONAL - overrides.keys) do
      rendered = ERB.new(File.read(Rails.root.join("config/deploy.yml"))).result
      YAML.safe_load(rendered, aliases: true).fetch("env").fetch("clear")
    end
  end

  def with_env(values, cleared: [])
    previous = ENV.to_h.slice(*(values.keys + cleared))
    cleared.each { |key| ENV.delete(key) }
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    (values.keys + cleared).each { |key| ENV.delete(key) }
    previous.each { |key, value| ENV[key] = value }
  end

  test "unset optional variables render as empty strings, not nil" do
    clear = render_clear_env

    OPTIONAL.each do |name|
      assert_equal "", clear.fetch(name), "#{name} must be a YAML string when unset"
    end
  end

  test "TYPESAFE_API_KEY is a required secret on every deploy, with or without the old KAMAL_COMPOUND_WRITING switch" do
    secrets = lambda do |flag|
      with_env(REQUIRED.merge(flag), cleared: OPTIONAL + (flag.empty? ? %w[KAMAL_COMPOUND_WRITING] : [])) do
        rendered = ERB.new(File.read(Rails.root.join("config/deploy.yml"))).result
        YAML.safe_load(rendered, aliases: true).fetch("env").fetch("secret")
      end
    end

    assert_includes secrets.call({}), "TYPESAFE_API_KEY"
    assert_includes secrets.call("KAMAL_COMPOUND_WRITING" => "1"), "TYPESAFE_API_KEY"
  end

  test "bin/typesafe-key resolves the exported variable, then the checkout's .env, else fails" do
    script = Rails.root.join("bin/typesafe-key").to_s
    Dir.mktmpdir do |dir|
      out, status = Open3.capture2e({ "TYPESAFE_API_KEY" => "from-env" }, script, chdir: dir)
      assert status.success?
      assert_equal "from-env", out

      File.write(File.join(dir, ".env"), "OTHER=1\nexport TYPESAFE_API_KEY=\"from-dotenv\" # comment\n")
      out, status = Open3.capture2e({ "TYPESAFE_API_KEY" => nil }, script, chdir: dir)
      assert status.success?
      assert_equal "from-dotenv", out

      File.write(File.join(dir, ".env"), "TYPESAFE_API_KEY=\n")
      out, status = Open3.capture2e({ "TYPESAFE_API_KEY" => nil }, script, chdir: dir)
      assert_not status.success?
      assert_match(/TYPESAFE_API_KEY is not set/, out)
    end
  end

  test "the pre-build hook fails without a resolvable key and passes with one" do
    hook = Rails.root.join(".kamal/hooks/pre-build").to_s
    assert File.executable?(hook)
    assert File.executable?(Rails.root.join("bin/typesafe-key"))
    Dir.mktmpdir do |dir|
      FileUtils.mkdir_p(File.join(dir, "bin"))
      FileUtils.cp(Rails.root.join("bin/typesafe-key"), File.join(dir, "bin/typesafe-key"))
      out, status = Open3.capture2e({ "TYPESAFE_API_KEY" => nil }, hook, chdir: dir)
      assert_not status.success?
      assert_match(/refusing to deploy without TYPESAFE_API_KEY/, out)

      _out, status = Open3.capture2e({ "TYPESAFE_API_KEY" => "k" }, hook, chdir: dir)
      assert status.success?
    end
  end

  test "set optional variables render verbatim" do
    clear = render_clear_env(
      "WEBMCP_ORIGIN_TRIAL_TOKEN" => "AbC123+/=",
      "RIFFREC_AUTOMATION_EMAILS" => "one@example.com,two@example.com"
    )

    assert_equal "AbC123+/=", clear.fetch("WEBMCP_ORIGIN_TRIAL_TOKEN")
    assert_equal "one@example.com,two@example.com", clear.fetch("RIFFREC_AUTOMATION_EMAILS")
  end
end
