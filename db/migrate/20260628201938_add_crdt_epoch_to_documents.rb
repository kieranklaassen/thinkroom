# Monotonic content generation. Bumped only when replace_content! resets the
# document's CRDT/source state, so the relay layer can reject frames produced
# from a superseded generation instead of letting them resurrect old content.
class AddCrdtEpochToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :crdt_epoch, :integer, default: 0, null: false
  end
end
