class CreateDocuments < ActiveRecord::Migration[8.1]
  def change
    create_table :documents do |t|
      t.string :title, null: false, default: "Untitled"
      t.string :slug, null: false
      t.binary :yjs_state
      t.text :content_markdown
      t.json :provenance_spans, default: []
      t.text :seed_markdown
      t.string :seed_state, null: false, default: "pending"
      t.timestamps
    end
    add_index :documents, :slug, unique: true
  end
end
