class AddEditingLockedToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :editing_locked, :boolean, default: false, null: false
  end
end
