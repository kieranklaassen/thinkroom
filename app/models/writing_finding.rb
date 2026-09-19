# One flagged unit from a writing pass: which reviewer and question fired, the
# unit's scope, and enough of the paragraph the client sent to anchor it back
# into the live editor (paragraph text and index, quote and its offset).
# Text-scope findings have no anchor. Dismissal hides a finding for everyone
# until the next pass.
class WritingFinding < ApplicationRecord
  belongs_to :document
  belongs_to :writing_pass

  validates :reviewer_key, :question_id, presence: true
  validates :scope, inclusion: { in: CompoundWriting::Lens::SCOPES }
  validates :probability, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: 1 }

  scope :active, -> { where(dismissed_at: nil) }

  # A ParagraphReview::Finding's fields are exactly these columns.
  def self.from_review(finding, pass:)
    new(finding.to_h.merge(document_id: pass.document_id, writing_pass: pass))
  end

  def dismiss!
    return if dismissed_at

    update!(dismissed_at: Time.current)
    DocumentMetaChannel.broadcast_event_after_commit(document, :writing_pass)
  end

  # From the pass's own lens snapshot, so a later pack change cannot relabel it.
  def question = writing_pass.lens(reviewer_key)&.question(question_id)

  def as_props
    {
      id:, reviewer_key:, question_id:, scope:, paragraph_index:, paragraph_text:, quote:, quote_offset:,
      probability: probability.round(2), note: question&.note
    }
  end
end
