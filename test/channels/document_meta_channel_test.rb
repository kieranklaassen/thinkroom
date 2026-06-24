require "test_helper"

class DocumentMetaChannelTest < ActionCable::Channel::TestCase
  test "subscribing reports the running release version" do
    document = Document.create!(title: "Live")

    subscribe slug: document.slug

    assert subscription.confirmed?
    assert_equal "version", transmissions.last["event"]
    assert_equal ENV.fetch("KAMAL_VERSION", "development"), transmissions.last["version"]
  end

  test "subscribing to a missing document is rejected" do
    subscribe slug: "missing"

    assert subscription.rejected?
  end
end
