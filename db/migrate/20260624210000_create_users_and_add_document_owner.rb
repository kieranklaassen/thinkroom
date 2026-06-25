class CreateUsersAndAddDocumentOwner < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :name, null: false, limit: 255
      t.string :email, null: false, limit: 320
      t.string :password_digest
      t.string :google_uid

      t.timestamps
    end

    add_index :users, :email, unique: true
    add_index :users, :google_uid, unique: true

    add_reference :documents, :user, foreign_key: true
    add_check_constraint :documents,
                         "user_id IS NULL OR owner_token IS NULL",
                         name: "documents_single_owner"
  end
end
