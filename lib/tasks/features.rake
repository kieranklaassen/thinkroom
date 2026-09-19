# Per-account feature grants (Features). Run in the deployed container:
#   bin/kamal app exec --reuse 'bin/rails "features:grant[someone@example.com,compound_writing]"'
namespace :features do
  desc "Grant a feature to an account: features:grant[email,key]"
  task :grant, [ :email, :key ] => :environment do |_task, args|
    user = features_user!(args[:email])
    changed = user.grant_feature!(args[:key])
    puts "#{changed ? 'Granted' : 'Already granted'} #{args[:key]} to #{user.email}"
  end

  desc "Revoke a feature from an account: features:revoke[email,key]"
  task :revoke, [ :email, :key ] => :environment do |_task, args|
    user = features_user!(args[:email])
    changed = user.revoke_feature!(args[:key])
    puts "#{changed ? 'Revoked' : 'Was not granted'} #{args[:key]} for #{user.email}"
  end

  desc "List the accounts holding a feature: features:list[key]"
  task :list, [ :key ] => :environment do |_task, args|
    users = User.with_feature(args[:key]).order(:email)
    puts users.any? ? users.map { |user| "#{user.email} (#{user.features.dig(args[:key], 'granted_at')})" } : "No accounts hold #{args[:key]}"
  end

  def features_user!(email)
    user = User.find_by(email: email.to_s.strip.downcase)
    abort "No account with email #{email.inspect}" unless user

    user
  end
end
