class AddSeedClaimedAtToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :seed_claimed_at, :datetime
  end
end
