# Feature management moves to Flipper (as in Cora). Every account holding the
# round-two `users.features["compound_writing"]` grant becomes an enabled
# actor on the :compound_writing flag, accounts named in THINKROOM_ADMIN_EMAILS
# (a deployment variable) become admins, and the JSON column goes away.
class MoveCompoundWritingFeatureToFlipper < ActiveRecord::Migration[8.1]
  FLAG = "compound_writing"

  def up
    Flipper.add(FLAG) unless Flipper.exist?(FLAG)

    if column_exists?(:users, :features)
      ids = select_values("SELECT id FROM users WHERE json_extract(features, '$.compound_writing') IS NOT NULL")
      ids.each { |id| Flipper.enable_actor(FLAG, Flipper::Actor.new("User;#{id}")) }
      say "enabled #{FLAG} for #{ids.size} account(s) that held the grant"
      remove_column :users, :features
    end

    emails = ENV.fetch("THINKROOM_ADMIN_EMAILS", "").split(",").map { |email| email.strip.downcase }.reject(&:blank?)
    if emails.any?
      promoted = update("UPDATE users SET admin = 1 WHERE email IN (#{emails.map { |email| connection.quote(email) }.join(', ')})")
      say "promoted #{promoted} admin account(s)"
    end
  end

  def down
    add_column :users, :features, :json, null: false, default: {}
    Flipper.feature(FLAG).actors_value.each do |actor_id|
      id = actor_id.split(";").last
      update("UPDATE users SET features = json_set(features, '$.compound_writing', json_object('granted_at', #{connection.quote(Time.current.iso8601)})) WHERE id = #{id.to_i}")
    end
  end
end
