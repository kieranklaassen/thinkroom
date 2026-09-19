# Per-account feature grants, stored on `users.features` as
# { "<key>" => { "granted_at" => iso8601 } }. A grant is a durable flag an
# operator sets without a deploy (`bin/rails "features:grant[email,key]"`);
# code reads it through `User#feature?`. Only the keys listed here exist.
module Features
  extend ActiveSupport::Concern

  COMPOUND_WRITING = "compound_writing"
  KEYS = [ COMPOUND_WRITING ].freeze

  class UnknownFeature < ArgumentError; end

  class_methods do
    def with_feature(key)
      key = Features.key!(key)
      where("json_extract(features, ?) IS NOT NULL", "$.#{key}")
    end
  end

  def feature?(key)
    features.is_a?(Hash) && features.key?(Features.key!(key))
  end

  def grant_feature!(key)
    key = Features.key!(key)
    return false if feature?(key)

    update!(features: (features || {}).merge(key => { "granted_at" => Time.current.iso8601 }))
    true
  end

  def revoke_feature!(key)
    key = Features.key!(key)
    return false unless feature?(key)

    update!(features: (features || {}).except(key))
    true
  end

  def self.key!(key)
    key = key.to_s
    raise UnknownFeature, "unknown feature #{key.inspect} (known: #{KEYS.join(', ')})" unless KEYS.include?(key)

    key
  end
end
