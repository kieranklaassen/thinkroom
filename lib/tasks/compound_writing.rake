# Compound writing packs. Run in the deployed container with
#   bin/kamal app exec --reuse 'bin/rails "compound_writing:install[EveryInc/compound-writing,someone@example.com]"'
# Enabling the feature itself is Flipper (flags:enable, or Flipper UI).
namespace :compound_writing do
  desc "Install or refresh a pack from a marketplace and subscribe an account: compound_writing:install[owner/repo@ref,email,plugin]"
  task :install, [ :locator, :email, :plugin ] => :environment do |_task, args|
    pack = CompoundWriting::PackInstaller.install!(args[:locator], plugin: args[:plugin].presence)
    puts "Installed #{pack.name} #{pack.version} at #{pack.short_sha} with #{pack.lens_structs.size} lenses"
    next if args[:email].blank?

    user = User.find_by(email: args[:email].to_s.strip.downcase) or abort "No account with email #{args[:email].inspect}"
    Flipper.enable_actor(CompoundWriting::FLAG, user)
    outcome = UserWritingPack.subscribe!(user, pack)
    puts "#{outcome.change.to_s.capitalize} subscription for #{user.email} (#{outcome.subscription.enabled_lenses.size} lenses on)"
  end

  desc "List packs and their lenses"
  task list: :environment do
    WritingPack.order(:name, created_at: :desc).each do |pack|
      puts "#{pack.name} #{pack.version} #{pack.source_locator}@#{pack.short_sha} (#{pack.users.count} accounts, version created #{pack.created_at.to_date})"
      pack.lens_structs.each { |lens| puts "  #{lens.key} [#{lens.origin}] #{lens.questions.size} questions" }
    end
  end
end

namespace :compound_writing do
  desc "Create or reset a password account with the flag enabled, for the browser check: compound_writing:check_account[email,password]"
  task :check_account, [ :email, :password ] => :environment do |_task, args|
    abort "compound_writing:check_account is for development and test only" if Rails.env.production?

    email = (args[:email].presence || "compound-check@example.com").downcase
    password = args[:password].presence || "thoughtful-passphrase"
    user = User.find_or_initialize_by(email:)
    user.name ||= "Compound Check"
    user.password = password
    # Admin too, so the check can open Flipper UI.
    user.admin = true
    user.save!
    Flipper.enable_actor(CompoundWriting::FLAG, user)
    pack = CompoundWriting::FirstPack.ensure_pack!
    puts "Check account #{email} (admin) has #{CompoundWriting::FLAG} enabled; #{pack.name}@#{pack.short_sha} (#{pack.lens_structs.size} lenses) is subscribed on first visit"
  end
end
