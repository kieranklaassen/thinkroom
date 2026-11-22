# One raw Yjs update appended by YjsPersistence.merge. Rows are the
# document's durable write-ahead tail: a fold (YjsPersistence) materializes
# them into the snapshot columns and deletes only rows it can prove
# incorporated. Insertion order (id) is fold-application order.
class YjsDocumentUpdate < ApplicationRecord
  belongs_to :document

  # Newly appended rows not yet examined by a fold. Inline fold thresholds
  # count only unexamined rows so lingering causally-pending rows never
  # trigger a fold storm on every subsequent keystroke.
  scope :unexamined, -> { where(retained_at: nil) }
end
