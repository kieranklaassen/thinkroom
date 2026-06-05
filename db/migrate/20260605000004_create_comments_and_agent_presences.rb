class CreateCommentsAndAgentPresences < ActiveRecord::Migration[8.1]
  def change
    create_table :comments do |t|
      t.references :document, null: false, foreign_key: true
      t.string :author_name, null: false
      t.string :author_kind, null: false, default: "human"
      t.text :body, null: false
      t.text :anchor_text
      t.datetime :resolved_at
      t.timestamps
    end
    add_index :comments, [ :document_id, :resolved_at ]

    create_table :agent_presences do |t|
      t.references :document, null: false, foreign_key: true
      t.string :agent_name, null: false
      t.string :status, null: false, default: "active"
      t.text :location_text
      t.datetime :last_seen_at, null: false
      t.timestamps
    end
    add_index :agent_presences, [ :document_id, :agent_name ], unique: true
  end
end
