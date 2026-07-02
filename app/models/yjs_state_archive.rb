# A retained copy of a document's CRDT state, written by the durability
# layer in YjsPersistence and Document#replace_content!. See the kind
# comments in the migration; only same-generation checkpoints are ever
# restored automatically (restoring across a generation bump would
# resurrect content a replacement deliberately wiped).
class YjsStateArchive < ApplicationRecord
  # Interval-gated pre-merge snapshot — the automatic restore candidate.
  CHECKPOINT = "checkpoint".freeze
  # State wiped by Document#replace_content! — manual undo only (its
  # generation is pre-bump, so automatic restore would resurrect content).
  REPLACEMENT = "replacement".freeze
  # Corrupt bytes kept for forensics — never restored.
  QUARANTINE = "quarantine".freeze

  KINDS = [ CHECKPOINT, REPLACEMENT, QUARANTINE ].freeze

  # Newest archives kept per document and kind; older ones are pruned on
  # every insert so retention stays bounded.
  MAX_PER_KIND = 5

  belongs_to :document

  validates :kind, inclusion: { in: KINDS }

  # Snapshot the document's current CRDT columns into an archive row and
  # prune the kind down to MAX_PER_KIND. Callers are expected to hold the
  # document's persistence locks (YjsPersistence) or row lock
  # (Document#replace_content!).
  def self.record!(document, kind:, generation: document.content_generation, error: nil)
    archive = create!(
      document:,
      kind:,
      content_generation: generation,
      yjs_state: document.yjs_state,
      yjs_state_vector: document.yjs_state_vector,
      error:
    )
    stale_ids = where(document:, kind:).order(created_at: :desc, id: :desc).offset(MAX_PER_KIND).ids
    where(id: stale_ids).delete_all if stale_ids.any?
    archive
  end
end
