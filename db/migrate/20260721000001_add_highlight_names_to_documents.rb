class AddHighlightNamesToDocuments < ActiveRecord::Migration[8.1]
  def change
    # Per-document names for the highlighter palette ({ "yellow" => "Urgent" }),
    # shown as the rail legend. Highlight ranges themselves live in the
    # document content (marks); only the shared color names persist here.
    add_column :documents, :highlight_names, :json, default: {}, null: false
  end
end
