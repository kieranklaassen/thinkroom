class AddYjsStateChecksumToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :yjs_state_checksum, :string
  end
end
