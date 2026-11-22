class AddRetainedAtToYjsDocumentUpdates < ActiveRecord::Migration[8.1]
  def change
    # Stamped on causally-pending rows that survived a fold without
    # integrating. YjsPersistence.merge counts only unexamined rows
    # (retained_at IS NULL) toward FOLD_THRESHOLD so lingering pending rows
    # never trigger a synchronous fold storm on every subsequent keystroke.
    add_column :yjs_document_updates, :retained_at, :datetime
    add_index :yjs_document_updates, :document_id,
              where: "retained_at IS NULL",
              name: "index_yjs_document_updates_on_document_id_unexamined"
  end
end
