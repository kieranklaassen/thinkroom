class AddLinkAccessToDocuments < ActiveRecord::Migration[8.1]
  def up
    add_column :documents, :link_access, :string, default: "edit", null: false
    execute <<~SQL.squish
      UPDATE documents
      SET link_access = 'view'
      WHERE editing_locked = 1
    SQL
    add_check_constraint :documents,
                         "link_access IN ('edit', 'comment', 'view')",
                         name: "documents_link_access_check"
  end

  def down
    remove_check_constraint :documents, name: "documents_link_access_check"
    remove_column :documents, :link_access
  end
end
