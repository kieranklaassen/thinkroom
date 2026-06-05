class AddOwnershipToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :owner_token, :string
    add_column :documents, :owner_name, :string, limit: 255
    add_column :documents, :claimed_at, :datetime

    add_index :documents, :owner_token
  end
end
