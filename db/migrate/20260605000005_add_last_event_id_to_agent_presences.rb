class AddLastEventIdToAgentPresences < ActiveRecord::Migration[8.1]
  def change
    add_column :agent_presences, :last_event_id, :integer, null: false, default: 0
  end
end
