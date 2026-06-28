class AddContentGenerationToDocuments < ActiveRecord::Migration[8.1]
  # Monotonic counter bumped each time an owner replaces a live document's
  # source from the CLI (Document#replace_content!). Editor clients announce
  # the generation they loaded; the server drops CRDT/snapshot writes from a
  # client behind the current generation so a pre-reset session can never
  # resurrect the old document state.
  def change
    add_column :documents, :content_generation, :integer, default: 0, null: false
  end
end
