require "test_helper"

class DocumentPinsTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Worth keeping", owner_token: "someone-else", owner_name: "Other")
  end

  test "guest pins and unpins any readable document" do
    get root_path

    post document_pin_path(@document.slug)
    assert_response :see_other
    pin = DocumentPin.find_by!(document: @document)
    assert pin.owner_token.present?
    assert_nil pin.user_id

    delete document_pin_path(@document.slug)
    assert_response :see_other
    assert_not DocumentPin.exists?(document: @document)
  end

  test "signed in pins belong to the account, not the browser" do
    user = sign_in_user

    post document_pin_path(@document.slug)

    pin = DocumentPin.find_by!(document: @document)
    assert_equal user.id, pin.user_id
    assert_nil pin.owner_token
  end

  test "repeated pin and unpin requests both succeed" do
    get root_path

    2.times do
      post document_pin_path(@document.slug)
      assert_response :see_other
    end
    assert_equal 1, DocumentPin.where(document: @document).count

    2.times do
      delete document_pin_path(@document.slug)
      assert_response :see_other
    end
    assert_equal 0, DocumentPin.count
  end

  test "a missing document redirects home" do
    get root_path

    post document_pin_path("missing")
    assert_redirected_to root_path

    delete document_pin_path("missing")
    assert_redirected_to root_path
  end

  test "pinning past the cap is refused with an error message" do
    user = sign_in_user
    DocumentPin::MAX_PER_OWNER.times do |i|
      DocumentPin.pin!(Document.create!(title: "Doc #{i}"), user:, token: nil)
    end

    post document_pin_path(@document.slug)

    assert_response :redirect
    assert_equal "You can pin up to 50 pages.", session[:inertia_errors]&.dig(:pin)
    assert_not DocumentPin.exists?(document: @document)
  end

  test "pinning is rate limited per IP" do
    get root_path
    WriteRateLimited::CONTRIBUTION_BURST_LIMIT.times do
      post document_pin_path(@document.slug)
    end

    other = Document.create!(title: "One too many")
    post document_pin_path(other.slug)

    assert_response :too_many_requests
    assert_not DocumentPin.exists?(document: other)
  end

  test "forged pin POST without CSRF token is rejected" do
    original = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    get root_path

    post document_pin_path(@document.slug)

    assert_response :unprocessable_entity
    assert_not DocumentPin.exists?(document: @document)
  ensure
    ActionController::Base.allow_forgery_protection = original
  end

  private

  def sign_in_user
    user = User.create!(name: "Reader", email: "reader@example.com", password: "thoughtful-passphrase")
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }
    assert_response :see_other
    user
  end
end
