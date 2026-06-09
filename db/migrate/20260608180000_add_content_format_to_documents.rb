class AddContentFormatToDocuments < ActiveRecord::Migration[8.1]
  def up
    add_column :documents, :content_format, :string, null: false, default: "markdown"
  end

  def down
    html_documents = select_value("SELECT COUNT(*) FROM documents WHERE content_format = 'html'").to_i
    if html_documents.positive?
      raise ActiveRecord::IrreversibleMigration,
            "Cannot remove content_format while HTML documents exist"
    end

    remove_column :documents, :content_format
  end
end
