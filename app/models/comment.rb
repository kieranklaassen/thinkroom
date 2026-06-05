# A remark anchored to a text selection, resolvable. Humans and agents both
# comment through this model — attribution travels in author_kind.
class Comment < ApplicationRecord
  AUTHOR_KINDS = %w[human agent].freeze

  belongs_to :document

  validates :author_name, :body, presence: true
  validates :author_kind, inclusion: { in: AUTHOR_KINDS }

  scope :open, -> { where(resolved_at: nil) }
  scope :resolved, -> { where.not(resolved_at: nil) }

  def resolve!
    update!(resolved_at: Time.current)
  end

  def as_props
    slice(:id, :author_name, :author_kind, :body, :anchor_text)
      .merge(resolved: resolved_at.present?, created_at: created_at.iso8601)
  end
end
