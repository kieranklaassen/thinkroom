class CreateWritingPacks < ActiveRecord::Migration[8.1]
  def change
    # One plugin from a Claude Code plugin marketplace, pinned to a commit and
    # stored with the lenses derived from its skills.
    create_table :writing_packs do |t|
      t.string :name, null: false
      t.string :display_name, null: false
      t.text :description
      t.string :source_kind, null: false, default: "github"
      t.string :source_locator, null: false
      t.string :source_ref
      t.string :source_sha, null: false
      t.string :plugin_name, null: false
      t.string :version
      t.json :lenses, null: false, default: []
      t.datetime :fetched_at
      t.timestamps
    end
    add_index :writing_packs, %i[source_locator plugin_name], unique: true

    # An account's subscription to a pack, with the lenses it switched off.
    create_table :user_writing_packs do |t|
      t.references :user, null: false, foreign_key: true, index: true
      t.references :writing_pack, null: false, foreign_key: true, index: true
      t.json :disabled_lens_keys, null: false, default: []
      t.integer :position, null: false, default: 0
      t.timestamps
    end
    add_index :user_writing_packs, %i[user_id writing_pack_id], unique: true

    # The lens definitions a pass ran with, so jobs and cards stay consistent
    # when a pack changes later.
    add_column :writing_passes, :lenses, :json, null: false, default: []
  end
end
