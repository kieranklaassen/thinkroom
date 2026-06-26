# A remark anchored to a text selection, resolvable. Humans and agents both
# comment through this model — attribution travels in author_kind.
class Comment < ApplicationRecord
  AUTHOR_KINDS = %w[human agent].freeze

  belongs_to :document

  validates :author_name, :body, presence: true
  validates :author_kind, inclusion: { in: AUTHOR_KINDS }

  scope :open, -> { where(resolved_at: nil) }
  scope :resolved, -> { where.not(resolved_at: nil) }

  # Single entry point for posting a comment — UI and agent API both use it.
  def self.post!(document:, author_name:, author_kind:, body:, anchor_text: nil)
    comment = document.comments.create!(author_name:, author_kind:, body:, anchor_text:)
    Activity.log!(
      document:,
      actor_name: author_name,
      actor_kind: author_kind,
      action: "commented",
      detail: body.to_s.truncate(80)
    )
    DocumentMetaChannel.broadcast_event_after_commit(document, :comments)
    comment
  end

  def resolve!
    update!(resolved_at: Time.current)
  end

  def as_props
    slice(:id, :author_name, :author_kind, :body, :anchor_text)
      .merge(resolved: resolved_at.present?, created_at: created_at.iso8601)
  end
end
