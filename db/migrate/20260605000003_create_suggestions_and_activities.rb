class CreateSuggestionsAndActivities < ActiveRecord::Migration[8.1]
  def change
    create_table :suggestions do |t|
      t.references :document, null: false, foreign_key: true
      t.string :author_name, null: false
      t.string :author_kind, null: false, default: "ai"
      t.string :intent
      t.text :body, null: false
      t.text :anchor_text
      t.text :replaces
      t.string :status, null: false, default: "pending"
      t.string :resolved_by
      t.timestamps
    end
    add_index :suggestions, [ :document_id, :status ]

    create_table :activities do |t|
      t.references :document, null: false, foreign_key: true
      t.string :actor_name, null: false
      t.string :actor_kind, null: false, default: "human"
      t.string :action, null: false
      t.text :detail
      t.datetime :created_at, null: false
    end
    add_index :activities, [ :document_id, :created_at ]
  end
end
