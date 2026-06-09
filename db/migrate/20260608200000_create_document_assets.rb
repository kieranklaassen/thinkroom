class CreateDocumentAssets < ActiveRecord::Migration[8.1]
  def change
    create_table :document_assets do |t|
      t.references :document, foreign_key: true
      t.string :uploader_name, null: false, limit: 255
      t.datetime :expires_at, null: false
      t.timestamps
    end

    add_index :document_assets, [ :document_id, :expires_at ]
    add_index :document_assets, :expires_at, where: "document_id IS NULL"
  end
end
