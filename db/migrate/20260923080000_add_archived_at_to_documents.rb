class AddArchivedAtToDocuments < ActiveRecord::Migration[8.1]
  def change
    # Archiving is the owner's "put it away" on the index: the document stays
    # readable by link and keeps its content; it just leaves Contents and
    # Pinned until restored.
    add_column :documents, :archived_at, :datetime
  end
end
