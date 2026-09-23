class CreateDocumentPins < ActiveRecord::Migration[8.1]
  def change
    # A pin is a private per-owner bookmark on the documents index. Ownership
    # mirrors documents: exactly one of user_id (signed in) or owner_token
    # (guest browser) — the same single-owner shape as documents_single_owner.
    create_table :document_pins do |t|
      t.references :document, null: false, foreign_key: true, index: false
      t.references :user, foreign_key: true, index: false
      t.string :owner_token

      t.timestamps
    end

    add_check_constraint :document_pins,
                         "(user_id IS NULL) <> (owner_token IS NULL)",
                         name: "document_pins_single_owner"

    # SQLite treats NULLs as distinct in a plain unique index, so each owner
    # column gets its own partial index; together they make pinning idempotent.
    add_index :document_pins, [ :document_id, :user_id ], unique: true, where: "user_id IS NOT NULL"
    add_index :document_pins, [ :document_id, :owner_token ], unique: true, where: "owner_token IS NOT NULL"
    add_index :document_pins, [ :user_id, :created_at ], where: "user_id IS NOT NULL"
    add_index :document_pins, [ :owner_token, :created_at ], where: "owner_token IS NOT NULL"
  end
end
