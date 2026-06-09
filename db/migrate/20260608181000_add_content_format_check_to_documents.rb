class AddContentFormatCheckToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_check_constraint :documents,
                         "content_format IN ('markdown', 'html')",
                         name: "documents_content_format"
  end
end
