class AddContentGenerationToDocuments < ActiveRecord::Migration[8.1]
  def change
    # Advances only on Document#replace_content! — the durable signal that a
    # connected SyncChannel client's in-flight Yjs frame predates a CLI owner
    # replacement and must be rejected rather than merged. See
    # docs/plans/2026-06-30-001-fix-cli-replacement-stale-crdt-race-plan.md.
    add_column :documents, :content_generation, :integer, null: false, default: 0
  end
end
