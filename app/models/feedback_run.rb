class FeedbackRun < ApplicationRecord
  STATUSES = %w[uploaded running finished failed].freeze

  belongs_to :user
  has_one_attached :archive

  validates :client_session_id, presence: true, length: { maximum: 255 }, uniqueness: { scope: :user_id }
  validates :status, inclusion: { in: STATUSES }

  def terminal? = status.in?(%w[finished failed])

  def public_status
    {
      id:,
      status:,
      cursor_status:,
      agent_url: cursor_agent_url,
      branch_name: cursor_branch_name,
      pr_url: cursor_pr_url,
      error: error_message
    }.compact
  end
end
