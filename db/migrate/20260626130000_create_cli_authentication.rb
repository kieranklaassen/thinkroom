class CreateCliAuthentication < ActiveRecord::Migration[8.1]
  def change
    create_table :cli_device_authorizations do |t|
      t.string :device_code_digest, null: false, limit: 64
      t.string :user_code, null: false, limit: 9
      t.references :user, foreign_key: true
      t.datetime :expires_at, null: false
      t.datetime :approved_at
      t.datetime :consumed_at
      t.datetime :last_polled_at

      t.timestamps
    end
    add_index :cli_device_authorizations, :device_code_digest, unique: true
    add_index :cli_device_authorizations, :user_code, unique: true

    create_table :cli_access_tokens do |t|
      t.references :user, null: false, foreign_key: true
      t.string :token_digest, null: false, limit: 64
      t.string :name, null: false, default: "Thinkroom CLI", limit: 255
      t.datetime :last_used_at
      t.datetime :revoked_at

      t.timestamps
    end
    add_index :cli_access_tokens, :token_digest, unique: true
  end
end
