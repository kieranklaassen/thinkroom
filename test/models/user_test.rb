require "test_helper"

class UserTest < ActiveSupport::TestCase
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
end
