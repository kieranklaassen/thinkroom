class CreateYjsStateArchives < ActiveRecord::Migration[8.1]
  def change
    create_table :yjs_state_archives do |t|
      t.references :document, null: false, foreign_key: true
      # checkpoint: interval-gated pre-merge snapshot (restore candidate)
      # replacement: state wiped by Document#replace_content! (manual undo)
      # quarantine: corrupt bytes kept for forensics, never restored
      t.string :kind, null: false
      t.integer :content_generation, null: false
      t.binary :yjs_state
      t.binary :yjs_state_vector
      t.string :error
      t.datetime :created_at, null: false
    end

    add_index :yjs_state_archives, [ :document_id, :kind, :created_at ]
  end
end
