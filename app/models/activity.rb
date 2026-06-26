# Append-only feed of what collaborators (especially agents) did in a doc.
class Activity < ApplicationRecord
  belongs_to :document

  validates :actor_name, :action, presence: true

  scope :recent, -> { order(created_at: :desc).limit(50) }

  # Log and announce in one step — every activity is broadcast live.
  def self.log!(document:, actor_name:, actor_kind:, action:, detail: nil)
    activity = create!(document:, actor_name:, actor_kind:, action:, detail:)
    DocumentMetaChannel.broadcast_event_after_commit(document, :activities)
    activity
  end

  def as_props
    slice(:id, :actor_name, :actor_kind, :action, :detail)
      .merge(created_at: created_at.iso8601)
  end
end
