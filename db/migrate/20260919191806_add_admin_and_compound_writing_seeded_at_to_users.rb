class AddAdminAndCompoundWritingSeededAtToUsers < ActiveRecord::Migration[8.1]
  def change
    # Admin accounts reach the admin-only mounts (Flipper UI); promoted with
    # `bin/rails "admin:grant[email]"` or THINKROOM_ADMIN_EMAILS at migrate.
    add_column :users, :admin, :boolean, null: false, default: false
    # Set once when an enabled account is subscribed to the first pack on
    # its first Comment-mode visit, so a later removal is respected.
    add_column :users, :compound_writing_seeded_at, :datetime
  end
end
