class BootstrapCompoundWritingAccounts < ActiveRecord::Migration[8.1]
  # Round two's data migration granted `users.features["compound_writing"]`
  # and subscribed COMPOUND_WRITING_INITIAL_ACCOUNTS to the first pack.
  # Feature grants moved to Flipper (MoveCompoundWritingFeatureToFlipper) and
  # the first pack is subscribed lazily on first visit
  # (CompoundWriting::FirstPack), so this migration no longer does anything.
  def up; end

  def down; end
end
