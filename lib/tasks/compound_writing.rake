# Compound writing packs and accounts. Run in the deployed container with
#   bin/kamal app exec --reuse 'bin/rails "compound_writing:install[EveryInc/compound-writing,someone@example.com]"'
namespace :compound_writing do
  desc "Install or refresh a pack from a marketplace and subscribe an account: compound_writing:install[owner/repo@ref,email,plugin]"
  task :install, [ :locator, :email, :plugin ] => :environment do |_task, args|
    pack = CompoundWriting::PackInstaller.install!(args[:locator], plugin: args[:plugin].presence)
    puts "Installed #{pack.name} #{pack.version} at #{pack.short_sha} with #{pack.lens_structs.size} lenses"
    next if args[:email].blank?

    user = User.find_by(email: args[:email].to_s.strip.downcase) or abort "No account with email #{args[:email].inspect}"
    user.grant_feature!(Features::COMPOUND_WRITING)
    subscription = user.user_writing_packs.find_or_create_by!(writing_pack: pack) do |row|
      row.position = (user.user_writing_packs.maximum(:position) || -1) + 1
    end
    puts "Subscribed #{user.email} (#{subscription.enabled_lenses.size} lenses on)"
  end

  desc "Grant the feature, build the first pack offline, and subscribe accounts: compound_writing:bootstrap[email1;email2]"
  task :bootstrap, [ :emails ] => :environment do |_task, args|
    emails = args[:emails].to_s.split(";").map { |email| email.strip.downcase }.reject(&:blank?)
    emails = CompoundWriting::Bootstrap.initial_accounts if emails.empty?
    result = CompoundWriting::Bootstrap.run!(emails:)
    puts "Pack #{result.pack.name}@#{result.pack.short_sha}; granted #{result.granted.join(', ').presence || 'nobody'}; " \
         "subscribed #{result.subscribed.join(', ').presence || 'nobody'}; missing #{result.missing.join(', ').presence || 'none'}"
  end

  desc "List packs and their lenses"
  task list: :environment do
    WritingPack.order(:name).each do |pack|
      puts "#{pack.name} #{pack.version} #{pack.source_locator}@#{pack.short_sha} (#{pack.users.count} accounts)"
      pack.lens_structs.each { |lens| puts "  #{lens.key} [#{lens.origin}] #{lens.questions.size} questions" }
    end
  end
end

namespace :compound_writing do
  desc "Create or reset a password account holding the feature and the first pack, for the browser check: compound_writing:check_account[email,password]"
  task :check_account, [ :email, :password ] => :environment do |_task, args|
    abort "compound_writing:check_account is for development and test only" if Rails.env.production?

    email = (args[:email].presence || "compound-check@example.com").downcase
    password = args[:password].presence || "thoughtful-passphrase"
    user = User.find_or_initialize_by(email:)
    user.name ||= "Compound Check"
    user.password = password
    user.save!
    result = CompoundWriting::Bootstrap.run!(emails: [ email ])
    puts "Check account #{email} holds compound_writing with #{result.pack.lens_structs.size} lenses from #{result.pack.name}@#{result.pack.short_sha}"
  end
end
