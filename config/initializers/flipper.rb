# Feature flags, the same shape as Cora: flags and their gates live in the
# database (flipper_features, flipper_gates), code checks a flag with a plain
# `Flipper.enabled?(:flag, user)`, and admins manage flags in Flipper UI at
# /admin/flipper (config/routes.rb, AdminConstraint).

# Group gate: enable a flag for every admin account at once.
Flipper.register(:admins) do |actor|
  actor.respond_to?(:admin?) && actor.admin?
end

Flipper::UI.configure do |config|
  config.banner_text = "Thinkroom feature flags"
  config.banner_class = "info"
  config.confirm_fully_enable = true
  config.descriptions_source = ->(_keys) { Flipper.flag_defaults.transform_values { |flag| flag["purpose"].to_s } }
end

module Flipper
  DEFAULTS_PATH = Rails.root.join("config/flipper_flag_defaults.yml")

  def self.flag_defaults
    @flag_defaults ||= (YAML.safe_load_file(DEFAULTS_PATH) || {}).to_h { |name, flag| [ name.to_s, flag.to_h ] }
  end

  # Registers every flag from config/flipper_flag_defaults.yml that does not
  # exist yet, so a fresh checkout has a consistent set of flags and Flipper
  # UI shows them. A flag that already exists is never touched. New flags are
  # created disabled in production regardless of the YAML; other environments
  # take the YAML's `enabled`.
  def self.load_flag_defaults!
    return unless ActiveRecord::Base.connection_pool.with_connection { |connection| connection.data_source_exists?("flipper_features") }

    flag_defaults.each do |name, flag|
      next if Flipper.exist?(name)

      Flipper.add(name)
      enabled = !Rails.env.production? && flag["enabled"] == true
      enabled ? Flipper.enable(name) : Flipper.disable(name)
      Rails.logger.info { "Flipper: registered #{name} -> #{enabled}" }
    end
  rescue ActiveRecord::NoDatabaseError, ActiveRecord::ConnectionNotEstablished, ActiveRecord::StatementInvalid
    # No database yet (assets:precompile in the image build, a bare CI step).
  end
end

Rails.application.config.after_initialize { Flipper.load_flag_defaults! }

# Every enable, disable, add, and remove lands in the log with who or what it
# targeted (Cora posts these to Slack; Thinkroom has no Slack).
ActiveSupport::Notifications.subscribe("feature_operation.flipper") do |event|
  operation = event.payload[:operation]
  next unless %i[enable disable add remove].include?(operation)

  thing = event.payload[:thing]
  target = thing.respond_to?(:value) ? thing.value : thing
  Rails.logger.info { "[flipper] #{operation} #{event.payload[:feature_name]} gate=#{event.payload[:gate_name]} target=#{target}" }
end
