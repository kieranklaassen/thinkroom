require "test_helper"

# Rows here are committed, so another connection can read and write them while
# a sign-in is under way.
class UserGoogleSignInTest < ActiveSupport::TestCase
  include CompoundWritingHelpers

  self.use_transactional_tests = false

  EMAIL = "google-sign-in@example.com"

  teardown { User.where("email LIKE ?", "#{EMAIL}%").delete_all }

  test "a sign-in with the same subject that finishes after the first lookup gives its account" do
    assert_winner_found
  end

  test "a sign-in with the same subject that finishes after the first lookup gives its account beside a password account" do
    User.create!(name: "Password", email: EMAIL, password: PASSWORD)
    assert_winner_found
  end

  test "the subject and email lookups run inside the immediate transaction" do
    User.create!(name: "Password", email: EMAIL, password: PASSWORD)

    queries = []
    log = ->(*, payload) { queries << payload[:sql] }
    ActiveSupport::Notifications.subscribed(log, "sql.active_record") { sign_in }

    start = queries.index { |sql| sql.match?(/BEGIN immediate/i) }
    finish = queries.index { |sql| sql.match?(/COMMIT/i) }
    subject = queries.rindex { |sql| sql.match?(/SELECT "users"\.\*.*"google_uid" = /) }
    email = queries.index { |sql| sql.include?("LIKE") }
    insert = queries.index { |sql| sql.start_with?("INSERT") }
    assert_equal [ start, subject, email, insert, finish ], [ start, subject, email, insert, finish ].sort
  end

  private

  def sign_in = User.for_google!(uid: "123", email: EMAIL, name: "Kieran")

  def assert_winner_found
    winner = nil
    # Another connection commits between the first lookup and the transaction.
    User.define_singleton_method(:transaction) do |**options, &block|
      if Thread.current == Thread.main && winner.nil?
        winner = false
        winner = Thread.new do
          User.with_connection { User.for_google!(uid: "123", email: EMAIL, name: "Kieran") }
        end.value
      end
      super(**options, &block)
    end

    assert_equal User.cache { sign_in }, winner
    assert winner.google_account?
    assert_equal 1, User.where(google_uid: "123").count
  ensure
    User.singleton_class.remove_method(:transaction)
  end
end
