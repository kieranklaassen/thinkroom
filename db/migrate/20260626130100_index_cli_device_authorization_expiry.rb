class IndexCliDeviceAuthorizationExpiry < ActiveRecord::Migration[8.1]
  def change
    add_index :cli_device_authorizations, :expires_at
  end
end
