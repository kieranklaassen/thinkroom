class AddSeedAuthorshipToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :seed_author_kind, :string
    add_column :documents, :seed_author_name, :string, limit: 255
  end
end
