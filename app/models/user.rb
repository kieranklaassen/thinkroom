class User < ApplicationRecord
  MINIMUM_PASSWORD_LENGTH = 10
  MAXIMUM_PASSWORD_BYTES = 72

  has_secure_password validations: false

  has_many :documents, dependent: :restrict_with_exception

  before_validation :normalize_identity

  validates :name, presence: true, length: { maximum: 255 }
  validates :email,
            presence: true,
            length: { maximum: 320 },
            format: { with: URI::MailTo::EMAIL_REGEXP },
            uniqueness: true
  validates :google_uid, uniqueness: true, allow_nil: true
  validates :password,
            length: { minimum: MINIMUM_PASSWORD_LENGTH },
            confirmation: true,
            allow_nil: true
  validate :password_within_bcrypt_limit
  validate :exactly_one_authentication_method

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

  private

  def normalize_identity
    self.name = Document.normalize_display_name(name)
    self.email = email.to_s.strip.downcase
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
