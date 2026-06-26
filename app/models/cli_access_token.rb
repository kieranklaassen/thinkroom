class CliAccessToken < ApplicationRecord
  TOKEN_PREFIX = "trm_"
  LAST_USED_TOUCH_INTERVAL = 5.minutes

  belongs_to :user

  validates :token_digest, presence: true, uniqueness: true, length: { is: 64 }
  validates :name, presence: true, length: { maximum: 255 }

  scope :active, -> { where(revoked_at: nil) }

  def self.issue!(user:, name: "Thinkroom CLI")
    raw_token = "#{TOKEN_PREFIX}#{SecureRandom.urlsafe_base64(32)}"
    record = create!(user:, name:, token_digest: digest(raw_token))
    [ record, raw_token ]
  end

  def self.authenticate(raw_token)
    return if raw_token.blank? || !raw_token.start_with?(TOKEN_PREFIX)

    token = active.includes(:user).find_by(token_digest: digest(raw_token))
    return unless token

    token.touch(:last_used_at) if token.last_used_at.nil? || token.last_used_at < LAST_USED_TOUCH_INTERVAL.ago
    token
  end

  def self.digest(value)
    Digest::SHA256.hexdigest(value.to_s)
  end

  def revoke!
    update!(revoked_at: Time.current) unless revoked_at?
  end
end
