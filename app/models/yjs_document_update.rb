# One raw Yjs update appended by YjsPersistence.merge. Rows are the
# document's durable write-ahead tail: a fold (YjsPersistence) materializes
# them into the snapshot columns and deletes only rows it can prove
# incorporated. Insertion order (id) is fold-application order.
class YjsDocumentUpdate < ApplicationRecord
  belongs_to :document
end
