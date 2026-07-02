class AddYjsStateVectorToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :yjs_state_vector, :binary
  end
end
