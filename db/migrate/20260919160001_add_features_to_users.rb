class AddFeaturesToUsers < ActiveRecord::Migration[8.1]
  def change
    # Per-account feature grants: { "compound_writing" => { "granted_at" => iso8601 } }.
    add_column :users, :features, :json, null: false, default: {}
  end
end
