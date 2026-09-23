require "test_helper"

class DocumentPinTest < ActiveSupport::TestCase
  setup do
    @user = User.create!(name: "Kieran", email: "kieran@example.com", password: "thoughtful-passphrase")
    @document = Document.create!(title: "Pinned", owner_token: "owner", owner_name: "Owner")
  end

  test "pinning twice keeps one pin per owner" do
    DocumentPin.pin!(@document, user: nil, token: "guest")
    DocumentPin.pin!(@document, user: nil, token: "guest")
    DocumentPin.pin!(@document, user: @user, token: "guest")
    DocumentPin.pin!(@document, user: @user, token: "guest")

    assert_equal 1, DocumentPin.where(owner_token: "guest").count
    assert_equal 1, DocumentPin.where(user: @user).count
    assert_nil DocumentPin.find_by(user: @user).owner_token
  end

  test "unpinning a document that was never pinned is a no-op" do
    assert_nothing_raised { DocumentPin.unpin!(@document, user: nil, token: "guest") }
    DocumentPin.pin!(@document, user: nil, token: "guest")
    DocumentPin.unpin!(@document, user: nil, token: "guest")

    assert_equal 0, DocumentPin.count
  end

  test "a blank guest token pins nothing and matches nothing" do
    assert_nil DocumentPin.pin!(@document, user: nil, token: "")
    assert_equal 0, DocumentPin.count
    assert_empty DocumentPin.for_owner(user: nil, token: nil)
  end

  test "the database requires exactly one owner column" do
    assert_raises(ActiveRecord::StatementInvalid) do
      DocumentPin.insert_all!([ { document_id: @document.id, user_id: @user.id, owner_token: "both" } ])
    end
    assert_raises(ActiveRecord::StatementInvalid) do
      DocumentPin.insert_all!([ { document_id: @document.id, user_id: nil, owner_token: nil } ])
    end
  end

  test "an owner can hold at most the cap and other owners are unaffected" do
    documents = Array.new(DocumentPin::MAX_PER_OWNER) { |i| Document.create!(title: "Doc #{i}") }
    documents.each { |document| DocumentPin.pin!(document, user: nil, token: "guest") }

    assert_raises(DocumentPin::CapReached) { DocumentPin.pin!(@document, user: nil, token: "guest") }
    assert_nothing_raised { DocumentPin.pin!(documents.first, user: nil, token: "guest") }
    assert DocumentPin.pin!(@document, user: nil, token: "other")
  end

  test "destroying a pinned document removes its pins" do
    DocumentPin.pin!(@document, user: nil, token: "guest")
    DocumentPin.pin!(@document, user: @user, token: nil)

    @document.destroy!

    assert_equal 0, DocumentPin.count
  end

  test "for_owner prefers the account over the guest token" do
    other = Document.create!(title: "Guest pin")
    DocumentPin.pin!(@document, user: @user, token: nil)
    DocumentPin.pin!(other, user: nil, token: "guest")

    assert_equal [ @document.id ], DocumentPin.for_owner(user: @user, token: "guest").pluck(:document_id)
    assert_equal [ other.id ], DocumentPin.for_owner(user: nil, token: "guest").pluck(:document_id)
  end
end
