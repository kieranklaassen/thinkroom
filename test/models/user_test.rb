require "test_helper"

class UserTest < ActiveSupport::TestCase
  include CompoundWritingHelpers

  test "password account normalizes email and authenticates" do
    user = User.create!(
      name: "Kieran",
      email: "  KIERAN@Example.com ",
      password: "thoughtful-passphrase",
      password_confirmation: "thoughtful-passphrase"
    )

    assert_equal "kieran@example.com", user.email
    assert user.password_account?
    assert user.authenticate("thoughtful-passphrase")
    assert_not user.authenticate("wrong-password")
  end

  test "password account normalizes name" do
    user = User.new(
      name: "  Kieran  ",
      email: "kieran@example.com",
      password: "thoughtful-passphrase"
    )

    assert user.valid?
    assert_equal "Kieran", user.name
  end

  test "google account is valid without a password" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", google_uid: "google-123")

    assert user.google_account?
    assert_not user.password_account?
    assert_not user.authenticate("anything")
  end

  test "account requires exactly one authentication method" do
    user = User.new(name: "Kieran", email: "kieran@example.com")
    assert_not user.valid?
    assert_includes user.errors[:base], "Choose a password or Google sign-in"

    user.password = user.password_confirmation = "thoughtful-passphrase"
    user.google_uid = "google-123"
    assert_not user.valid?
    assert_includes user.errors[:base], "Account cannot use both password and Google sign-in"
  end

  test "email and google uid are unique" do
    User.create!(name: "First", email: "first@example.com", google_uid: "google-123")

    duplicate_email = User.new(
      name: "Second",
      email: "FIRST@example.com",
      password: "thoughtful-passphrase",
      password_confirmation: "thoughtful-passphrase"
    )
    assert_not duplicate_email.valid?
    assert_includes duplicate_email.errors[:email], "has already been taken"

    duplicate_google = User.new(name: "Second", email: "second@example.com", google_uid: "google-123")
    assert_not duplicate_google.valid?
    assert_includes duplicate_google.errors[:google_uid], "has already been taken"
  end

  test "account_email is the plain address of every account" do
    password_user = User.create!(name: "Kieran", email: "kieran@example.com", password: PASSWORD)
    google_user = User.for_google!(uid: "123", email: "kieran@example.com", name: "Kieran")
    other = User.for_google!(uid: "456", email: "other@example.com", name: "Other")

    assert_equal "kieran@example.com", password_user.account_email
    assert_equal "kieran@example.com", google_user.account_email
    assert_equal "other@example.com", other.email
    assert_equal "other@example.com", other.account_email
    assert_equal [ password_user, google_user ], User.with_account_email("KIERAN@example.com").sort_by(&:id)
    assert google_user.update(name: "Renamed")
  end

  test "a separate Google account's stored email differs every time and stays within the reserved form" do
    stored = 2.times.map do |index|
      User.create!(name: "Kieran", email: "person#{index}@example.com", password: PASSWORD)
      User.for_google!(uid: "12#{index}", email: "person#{index}@example.com", name: "Kieran").email
    end

    stored.each_with_index do |email, index|
      assert_match(/\Aperson#{index}@example\.com\.\h{32}\.google\.invalid\z/, email)
      assert_no_match(/12#{index}\.google/, email)
    end
    assert_not_equal stored[0][-47..], stored[1][-47..]
  end

  test "a password account in the reserved form does not affect a Google sign-in for the plain email" do
    User.create!(name: "Kieran", email: "kieran@example.com", password: PASSWORD)
    User.new(name: "Other", email: "kieran@example.com.123.google.invalid", password: PASSWORD).save!(validate: false)
    User.new(name: "Other", email: "kieran@example.com.#{"a" * 32}.google.invalid", password: PASSWORD).save!(validate: false)

    google_user = User.for_google!(uid: "123", email: "kieran@example.com", name: "Kieran")

    assert google_user.google_account?
    assert_equal 2, User.with_account_email("kieran@example.com").size
  end

  test "an email that contains a reserved-looking part is its own email" do
    inner = "kieran@example.com.#{"a" * 32}.google.invalid.example.org"
    User.create!(name: "Kieran", email: "kieran@example.com", password: PASSWORD)
    User.create!(name: "Inner", email: inner, password: PASSWORD)
    google_inner = User.for_google!(uid: "123", email: inner, name: "Inner")

    assert_equal inner, google_inner.account_email
    assert_equal 1, User.with_account_email("kieran@example.com").size
    assert_nil User.for_google!(uid: "456", email: "new@example.com.#{"a" * 32}.google.invalid", name: "New")
  end

  test "with_account_email matches wildcard characters literally" do
    User.create!(name: "One", email: "a_b@example.com", password: PASSWORD)
    User.create!(name: "Two", email: "axb@example.com", password: PASSWORD)
    one = User.for_google!(uid: "1", email: "a_b@example.com", name: "One")
    User.for_google!(uid: "2", email: "axb@example.com", name: "Two")
    queries = []
    log = ->(*, payload) { queries << [ payload[:sql], *payload[:binds] ].join(" ") }
    ActiveSupport::Notifications.subscribed(log, "sql.active_record") { assert_includes User.with_account_email("a_b@example.com"), one }

    assert_equal [ "a_b@example.com" ], User.with_account_email("a_b@example.com").map(&:account_email).uniq
    assert_includes queries.last, "a\\_b@example.com"
    assert_empty User.with_account_email("%@example.com")
  end

  test "the length limit applies to the plain email of a separate Google account" do
    email = "#{"a" * 308}@example.com"
    User.create!(name: "Long", email:, password: PASSWORD)

    assert_equal email, User.for_google!(uid: "123", email:, name: "Long").account_email
    assert_not User.new(name: "Long", email: "a#{email}", password: PASSWORD).valid?
    assert_not User.new(name: "Long", email: "a#{email}", google_uid: "456").valid?
  end

  test "feedback automation goes by the plain address" do
    User.create!(name: "Password", email: "maintainer@example.com", password: PASSWORD)
    google_user = User.for_google!(uid: "123", email: "maintainer@example.com", name: "Google")

    assert FeedbackAutomation.allowed?(google_user)
  end

  test "an existing password account is not revalidated against the reserved form" do
    user = User.new(name: "Kieran", email: "kieran@example.com.123.google.invalid", password: PASSWORD)
    assert_not user.valid?
    user.save!(validate: false)

    assert user.reload.update(name: "Renamed")
    assert_equal "kieran@example.com.123.google.invalid", user.account_email
  end

  test "password has bounded length" do
    short = User.new(name: "Short", email: "short@example.com", password: "tiny")
    assert_not short.valid?
    assert_includes short.errors[:password], "is too short (minimum is 10 characters)"

    long = User.new(name: "Long", email: "long@example.com", password: "é" * 37)
    assert_not long.valid?
    assert_includes long.errors[:password], "is too long (maximum is 72 bytes)"
  end

  test "claim_documents promotes only matching anonymous ownership" do
    user = User.create!(
      name: "Kieran",
      email: "kieran@example.com",
      password: "thoughtful-passphrase"
    )
    first = Document.create!(title: "First", owner_token: "browser", owner_name: "Guest")
    second = Document.create!(title: "Second", owner_token: "browser", owner_name: "Guest")
    other = Document.create!(title: "Other", owner_token: "other", owner_name: "Other")
    already_owned = Document.create!(title: "Owned", user:, owner_name: "Kieran")

    assert_equal 2, user.claim_documents!("browser")
    assert_equal [ user.id, user.id ], [ first.reload.user_id, second.reload.user_id ]
    assert_nil first.owner_token
    assert_equal "Kieran", first.owner_name
    assert_equal "other", other.reload.owner_token
    assert_equal user.id, already_owned.reload.user_id
    assert_equal 0, user.claim_documents!("browser")
  end

  test "adopt_pins moves guest pins to the account without duplicates" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")
    shared = Document.create!(title: "Shared")
    guest_only = Document.create!(title: "Guest only")
    DocumentPin.pin!(shared, user:, token: nil)
    DocumentPin.pin!(shared, user: nil, token: "browser")
    DocumentPin.pin!(guest_only, user: nil, token: "browser")

    user.adopt_pins!("browser")

    assert_equal [ guest_only.id, shared.id ].sort, DocumentPin.where(user:).pluck(:document_id).sort
    assert_not DocumentPin.exists?(owner_token: "browser")
  end

  test "adopt_pins keeps the newest guest pins that fit under the cap" do
    user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")
    (DocumentPin::MAX_PER_OWNER - 1).times do |i|
      DocumentPin.pin!(Document.create!(title: "Account #{i}"), user:, token: nil)
    end
    older = Document.create!(title: "Older")
    newest = Document.create!(title: "Newest")
    travel_to(2.minutes.ago) { DocumentPin.pin!(older, user: nil, token: "browser") }
    DocumentPin.pin!(newest, user: nil, token: "browser")

    user.adopt_pins!("browser")

    assert_equal DocumentPin::MAX_PER_OWNER, DocumentPin.where(user:).count
    assert DocumentPin.exists?(user:, document: newest)
    assert_not DocumentPin.exists?(document: older)
    assert_raises(DocumentPin::CapReached) { DocumentPin.pin!(Document.create!(title: "One more"), user:, token: nil) }
  end
end
