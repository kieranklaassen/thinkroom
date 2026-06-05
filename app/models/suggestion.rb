# A proposed edit awaiting human review. Suggestions live in the database —
# not the Yjs doc — until a human accepts one, at which point the accepting
# client inserts the text into the CRDT carrying AI provenance marks.
class Suggestion < ApplicationRecord
  STATUSES = %w[pending accepted rejected].freeze
  AUTHOR_KINDS = %w[ai agent].freeze

  belongs_to :document

  validates :author_name, presence: true
  validates :author_kind, inclusion: { in: AUTHOR_KINDS }
  validates :body, presence: true
  validates :status, inclusion: { in: STATUSES }

  scope :pending, -> { where(status: "pending") }

  # The single entry point for proposing a suggestion — the UI's AI path and
  # the agent API both flow through here (create + activity + live broadcast),
  # so there is no side channel around the review machinery.
  def self.propose!(document:, author_name:, author_kind:, body:, intent: nil, anchor_text: nil, replaces: nil)
    suggestion = document.suggestions.create!(
      author_name:, author_kind:, body:, intent:, anchor_text:, replaces:,
      status: "pending"
    )
    Activity.log!(
      document:,
      actor_name: author_name,
      actor_kind: author_kind,
      action: "suggested",
      detail: intent.presence || body.truncate(80)
    )
    DocumentMetaChannel.broadcast_event(document, :suggestions)
    suggestion
  end

  def accept!(by: nil)
    transition!("accepted", by:)
  end

  def reject!(by: nil)
    transition!("rejected", by:)
  end

  def as_props
    slice(:id, :author_name, :author_kind, :intent, :body, :anchor_text, :replaces, :status)
      .merge(created_at: created_at.iso8601)
  end

  private

  def transition!(new_status, by:)
    raise ActiveRecord::RecordInvalid.new(self), "already #{status}" unless status == "pending"

    update!(status: new_status, resolved_by: by)
  end
end
