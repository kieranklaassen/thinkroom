class AddParagraphsDigestToWritingPasses < ActiveRecord::Migration[8.1]
  def change
    # Fingerprint of the judged paragraphs, so an identical rerun with the
    # same reviewers returns the finished pass instead of spending again.
    add_column :writing_passes, :paragraphs_digest, :string, limit: 8
    add_column :writing_passes, :estimated_nouls, :integer, null: false, default: 0
    add_column :writing_passes, :estimated_calls, :integer, null: false, default: 0
  end
end
