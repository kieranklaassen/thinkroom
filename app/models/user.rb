class User < ApplicationRecord
  MINIMUM_PASSWORD_LENGTH = 10
  MAXIMUM_PASSWORD_BYTES = 72
  # Email is unique, so a Google account whose address a password account
  # already uses stores "<email>.<random hex>.google.invalid" instead.
  # account_email gives the plain address back.
  RESERVED_EMAIL_SUFFIX = ".google.invalid"
  RESERVED_EMAIL_ENDING = /\.\h{32}#{Regexp.escape(RESERVED_EMAIL_SUFFIX)}\z/
  MAXIMUM_EMAIL_LENGTH = 320

  has_secure_password validations: false

  has_many :documents, dependent: :restrict_with_exception
  has_many :document_pins, dependent: :delete_all
  has_many :cli_access_tokens, dependent: :destroy
  has_many :cli_device_authorizations, dependent: :destroy
  has_many :feedback_runs, dependent: :destroy
  has_many :user_writing_packs, dependent: :destroy
  has_many :writing_packs, through: :user_writing_packs

  before_validation :normalize_identity

  validates :name, presence: true, length: { maximum: 255 }
  validates :email,
            presence: true,
            length: { maximum: ->(user) { MAXIMUM_EMAIL_LENGTH + user.email.length - user.account_email.length } },
            format: { with: URI::MailTo::EMAIL_REGEXP },
            uniqueness: true
  validates :google_uid, uniqueness: true, allow_nil: true
  validates :password,
            length: { minimum: MINIMUM_PASSWORD_LENGTH },
            confirmation: true,
            allow_nil: true
  validate :password_within_bcrypt_limit
  validate :exactly_one_authentication_method
  validate :email_not_reserved, on: :create, if: :password_account?

  # The account for a verified Google identity, created on first sign-in. It
  # is never an existing password account, whatever email that account uses.
  # Nil when another Google account has the email, or the email is in the
  # reserved form itself.
  def self.for_google!(uid:, email:, name:)
    attempts = 0
    begin
      # SQLite's immediate transaction keeps the lookups and the insert together.
      # A sign-in with the same subject can finish before it begins, and the
      # query cache still holds the first lookup, so the second skips the cache.
      find_by(google_uid: uid) || transaction do
        uncached { find_by(google_uid: uid) || create_for_google!(uid:, email:, name:) }
      end
    rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
      # An insert refused all the same is resolved from the start, up to twice.
      attempts += 1
      raise if attempts > 2

      retry
    end
  end

  # A password account and a Google account can answer to the same email.
  def self.with_account_email(email)
    email = email.to_s.strip.downcase
    where(email:)
      .or(where("email LIKE ? ESCAPE '\\'", "#{sanitize_sql_like(email)}.%#{RESERVED_EMAIL_SUFFIX}"))
      .select { |user| user.account_email == email }
  end

  def self.create_for_google!(uid:, email:, name:)
    return if email.end_with?(RESERVED_EMAIL_SUFFIX)

    holders = with_account_email(email)
    return if holders.any?(&:google_account?)

    stored = holders.any? ? "#{email}.#{SecureRandom.hex(16)}#{RESERVED_EMAIL_SUFFIX}" : email
    create!(name:, email: stored, google_uid: uid)
  end
  private_class_method :create_for_google!

  def account_email
    google_account? ? email.sub(RESERVED_EMAIL_ENDING, "") : email
  end

  def public_identity = slice(:id, :name).merge(email: account_email)

  def password_account? = password_digest.present?
  def google_account? = google_uid.present?

  def claim_documents!(owner_token)
    return 0 if owner_token.blank?

    transaction do
      Document.where(user_id: nil, owner_token:).update_all(
        user_id: id,
        owner_token: nil,
        owner_name: name,
        updated_at: Time.current
      )
    end
  end

  # Moves a guest browser's pins onto this account at sign-in, before the
  # owner token rotates. Documents the account already pinned drop their guest
  # duplicate, and only the newest guest pins that fit under the per-owner cap
  # move; the rest are discarded so the account never exceeds the cap.
  def adopt_pins!(owner_token)
    return if owner_token.blank?

    transaction do
      guest_pins = DocumentPin.where(user_id: nil, owner_token:)
      guest_pins.where(document_id: document_pins.select(:document_id)).delete_all

      room = [ DocumentPin::MAX_PER_OWNER - document_pins.count, 0 ].max
      keep_ids = guest_pins.order(created_at: :desc, id: :desc).limit(room).pluck(:id)
      guest_pins.where(id: keep_ids).update_all(user_id: id, owner_token: nil, updated_at: Time.current) if keep_ids.any?
      guest_pins.where.not(id: keep_ids).delete_all
    end
  end

  private

  def normalize_identity
    self.name = Document.normalize_display_name(name)
    self.email = email.to_s.strip.downcase
  end

  def email_not_reserved
    errors.add(:email, "is invalid") if email.end_with?(RESERVED_EMAIL_SUFFIX)
  end

  def password_within_bcrypt_limit
    return if password.nil? || password.bytesize <= MAXIMUM_PASSWORD_BYTES

    errors.add(:password, "is too long (maximum is #{MAXIMUM_PASSWORD_BYTES} bytes)")
  end

  def exactly_one_authentication_method
    methods = [ password_digest.present?, google_uid.present? ].count(true)
    errors.add(:base, "Choose a password or Google sign-in") if methods.zero?
    errors.add(:base, "Account cannot use both password and Google sign-in") if methods > 1
  end
end
