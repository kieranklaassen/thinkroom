class CreateWritingPasses < ActiveRecord::Migration[8.1]
  def change
    create_table :writing_passes do |t|
      t.references :document, null: false, foreign_key: true, index: true
      t.string :status, null: false, default: "queued"
      t.string :requested_by_name, null: false
      t.json :reviewer_keys, null: false, default: []
      t.json :reviewer_runs, null: false, default: {}
      t.json :paragraphs, null: false, default: []
      t.integer :word_count, null: false, default: 0
      t.datetime :finished_at
      t.timestamps
    end
    add_check_constraint :writing_passes, "status IN ('queued', 'running', 'finished', 'failed')", name: "writing_passes_status_check"

    create_table :writing_findings do |t|
      t.references :document, null: false, foreign_key: true, index: true
      t.references :writing_pass, null: false, foreign_key: true, index: true
      t.string :reviewer_key, null: false
      t.string :question_id, null: false
      t.string :scope, null: false
      t.integer :paragraph_index
      t.text :paragraph_text
      t.text :quote
      t.integer :quote_offset
      t.float :probability, null: false
      t.datetime :dismissed_at
      t.timestamps
    end
    add_check_constraint :writing_findings, "scope IN ('phrase', 'sentence', 'paragraph', 'text')", name: "writing_findings_scope_check"
  end
end
