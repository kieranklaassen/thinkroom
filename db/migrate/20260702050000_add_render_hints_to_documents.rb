class AddRenderHintsToDocuments < ActiveRecord::Migration[8.1]
  def change
    # Client-measured render geometry (currently Mermaid diagram heights keyed
    # by source hash) persisted from editor snapshots so the server-rendered
    # static preview and the next editor mount can reserve the right space
    # before the async renderer finishes — no growth jump on load.
    add_column :documents, :render_hints, :json, default: {}, null: false
  end
end
