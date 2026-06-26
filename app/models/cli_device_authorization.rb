class CliDeviceAuthorization < ApplicationRecord
  class InvalidDeviceCode < StandardError; end
  class AuthorizationPending < StandardError; end
  class PollingTooQuickly < StandardError; end
  class Expired < StandardError; end
  class AlreadyConsumed < StandardError; end
  class AlreadyApproved < StandardError; end

  LIFETIME = 10.minutes
  POLL_INTERVAL = 2.seconds
  USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

  belongs_to :user, optional: true

  scope :stale, -> { where(expires_at: ...1.day.ago) }

  validates :device_code_digest, presence: true, uniqueness: true, length: { is: 64 }
  validates :user_code, presence: true, uniqueness: true, format: { with: /\A[A-Z2-9]{4}-[A-Z2-9]{4}\z/ }
  validates :expires_at, presence: true

  def self.start!
    stale.delete_all
    raw_code = SecureRandom.urlsafe_base64(32)
    record = create!(
      device_code_digest: CliAccessToken.digest(raw_code),
      user_code: unique_user_code,
      expires_at: LIFETIME.from_now
    )
    [ record, raw_code ]
  end

  def self.exchange!(raw_device_code, now: Time.current)
    record = find_by(device_code_digest: CliAccessToken.digest(raw_device_code))
    raise InvalidDeviceCode unless record

    outcome = record.with_lock do
      record.reload
      raise Expired if record.expires_at <= now
      raise AlreadyConsumed if record.consumed_at?
      if record.last_polled_at && record.last_polled_at > now - POLL_INTERVAL
        next :polling_too_quickly
      end

      record.update!(last_polled_at: now)
      next :authorization_pending unless record.approved_at? && record.user

      token, raw_token = CliAccessToken.issue!(user: record.user)
      record.update!(consumed_at: now)
      [ token, raw_token ]
    end

    raise PollingTooQuickly if outcome == :polling_too_quickly
    raise AuthorizationPending if outcome == :authorization_pending

    outcome
  end

  def approve!(approving_user, now: Time.current)
    with_lock do
      reload
      raise Expired if expires_at <= now
      raise AlreadyConsumed if consumed_at?
      if approved_at?
        raise AlreadyApproved unless user_id == approving_user.id

        return self
      end

      update!(user: approving_user, approved_at: now)
    end
    self
  end

  def expired? = expires_at <= Time.current

  def self.normalize_user_code(value)
    compact = value.to_s.upcase.gsub(/[^A-Z2-9]/, "")
    return value.to_s.strip.upcase unless compact.length == 8

    "#{compact.first(4)}-#{compact.last(4)}"
  end

  def self.unique_user_code
    loop do
      characters = Array.new(8) { USER_CODE_ALPHABET[SecureRandom.random_number(USER_CODE_ALPHABET.length)] }
      code = "#{characters.first(4).join}-#{characters.last(4).join}"
      return code unless exists?(user_code: code)
    end
  end

  private_class_method :unique_user_code
end
