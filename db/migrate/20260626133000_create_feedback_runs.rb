class CreateFeedbackRuns < ActiveRecord::Migration[8.1]
  def change
    create_table :feedback_runs do |t|
      t.references :user, null: false, foreign_key: true
      t.string :client_session_id, null: false
      t.string :status, null: false, default: "uploaded"
      t.integer :launch_attempt, null: false, default: 0
      t.string :idempotency_key
      t.string :cursor_agent_id
      t.string :cursor_run_id
      t.string :cursor_agent_url
      t.string :cursor_status
      t.string :cursor_branch_name
      t.string :cursor_pr_url
      t.text :result_text
      t.text :error_message
      t.datetime :launched_at
      t.datetime :completed_at

      t.timestamps
    end

    add_index :feedback_runs, %i[user_id client_session_id], unique: true
    add_check_constraint :feedback_runs,
                         "status IN ('uploaded', 'running', 'finished', 'failed')",
                         name: "feedback_runs_status_check"
  end
end
