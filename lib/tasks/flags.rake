# Thin wrappers over Flipper for the console-less container (Flipper has no
# CLI; Flipper UI at /admin/flipper is the primary way to manage flags):
#   bin/kamal app exec --reuse 'bin/rails "flags:enable[compound_writing,someone@example.com]"'
namespace :flags do
  desc "Enable a flag for an account (or for everyone when no email): flags:enable[flag,email]"
  task :enable, [ :flag, :email ] => :environment do |_task, args|
    flag = flags_flag!(args[:flag])
    if args[:email].present?
      user = flags_user!(args[:email])
      Flipper.enable_actor(flag, user)
      puts "Enabled #{flag} for #{user.email}"
    else
      Flipper.enable(flag)
      puts "Enabled #{flag} for everyone"
    end
  end

  desc "Disable a flag for an account (or clear every gate when no email): flags:disable[flag,email]"
  task :disable, [ :flag, :email ] => :environment do |_task, args|
    flag = flags_flag!(args[:flag])
    if args[:email].present?
      user = flags_user!(args[:email])
      Flipper.disable_actor(flag, user)
      puts "Disabled #{flag} for #{user.email}"
    else
      Flipper.disable(flag)
      puts "Disabled #{flag} for everyone"
    end
  end

  desc "Show a flag's state and the accounts it is enabled for: flags:list[flag]"
  task :list, [ :flag ] => :environment do |_task, args|
    flag = flags_flag!(args[:flag])
    feature = Flipper.feature(flag)
    puts "#{flag}: #{feature.state}"
    ids = feature.actors_value.filter_map { |actor_id| actor_id.delete_prefix("User;") if actor_id.start_with?("User;") }
    User.where(id: ids).order(:email).each { |user| puts "  #{user.email}" }
    puts "  groups: #{feature.groups_value.to_a.join(', ')}" if feature.groups_value.any?
  end

  def flags_flag!(name)
    flag = name.to_s.strip
    abort "Name a flag from config/flipper_flag_defaults.yml: #{Flipper.flag_defaults.keys.join(', ')}" unless Flipper.flag_defaults.key?(flag)

    flag.to_sym
  end

  def flags_user!(email)
    User.find_by(email: email.to_s.strip.downcase) or abort "No account with email #{email.inspect}"
  end
end

namespace :admin do
  desc "Make an account an admin (Flipper UI and other admin mounts): admin:grant[email]"
  task :grant, [ :email ] => :environment do |_task, args|
    user = flags_user!(args[:email])
    user.update!(admin: true)
    puts "#{user.email} is an admin"
  end

  desc "Remove an account's admin access: admin:revoke[email]"
  task :revoke, [ :email ] => :environment do |_task, args|
    user = flags_user!(args[:email])
    user.update!(admin: false)
    puts "#{user.email} is no longer an admin"
  end

  desc "List admin accounts"
  task list: :environment do
    admins = User.where(admin: true).order(:email).pluck(:email)
    puts admins.any? ? admins : "No admin accounts"
  end
end
