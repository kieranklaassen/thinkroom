class CreateYjsDocumentUpdates < ActiveRecord::Migration[8.1]
  def change
    create_table :yjs_document_updates do |t|
      t.references :document, null: false, foreign_key: true
      # The document's content_generation at append time: folds skip and
      # delete rows from older generations so a replacement can never be
      # resurrected out of the log.
      t.integer :content_generation, null: false
      t.binary :payload, null: false
      t.datetime :created_at, null: false
    end
  end
end
