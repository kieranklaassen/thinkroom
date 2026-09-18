# One flagged unit from a writing pass: which reviewer and question fired, the
# unit's scope, and enough of the paragraph the client sent to anchor it back
# into the live editor (paragraph text and index, quote and its offset).
# Text-scope findings have no anchor. Dismissal hides a finding for everyone
# until the next pass.
class WritingFinding < ApplicationRecord
  belongs_to :document
  belongs_to :writing_pass

  validates :reviewer_key, :question_id, presence: true
  validates :scope, inclusion: { in: CompoundWriting::Reviewers::SCOPES }
  validates :probability, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: 1 }

  scope :active, -> { where(dismissed_at: nil) }

  def self.from_review(finding, pass:)
    new(
      document_id: pass.document_id, writing_pass: pass,
      reviewer_key: finding.reviewer_key, question_id: finding.question_id, scope: finding.scope,
      paragraph_index: finding.paragraph_index, paragraph_text: finding.paragraph_text,
      quote: finding.quote, quote_offset: finding.quote_offset, probability: finding.probability
    )
  end

  def dismiss!
    update!(dismissed_at: Time.current) if dismissed_at.nil?
    DocumentMetaChannel.broadcast_event_after_commit(document, :writing_pass)
  end

  def question = CompoundWriting::Reviewers.find(reviewer_key)&.question(question_id)

  def as_props
    {
      id:, reviewer_key:, question_id:, scope:, paragraph_index:, paragraph_text:, quote:, quote_offset:,
      probability: probability.round(2), note: question&.note
    }
  end
end
