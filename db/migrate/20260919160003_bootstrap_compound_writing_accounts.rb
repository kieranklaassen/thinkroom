class BootstrapCompoundWritingAccounts < ActiveRecord::Migration[8.1]
  # Data migration: builds the compound-writing pack offline and grants plus
  # subscribes the accounts in COMPOUND_WRITING_INITIAL_ACCOUNTS (a
  # deployment variable, so no address lives in the repository). Rerunnable;
  # db/seeds.rb calls the same bootstrap for development.
  def up
    return unless table_exists?(:writing_packs) && column_exists?(:users, :features)

    CompoundWriting::Bootstrap.run!
  rescue StandardError => e
    say "compound writing bootstrap skipped: #{e.class}: #{e.message}", true
  end

  def down
    # Grants and subscriptions are data; leave them.
  end
end
