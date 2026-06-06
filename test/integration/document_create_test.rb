require "test_helper"

# UI-created documents record seed authorship at the same INSERT that claims
# ownership: kind "human", name matching the owner attribution. The agent API
# counterpart (agent kind, header-derived name) is covered in agent_api_test.
class DocumentCreateTest < ActionDispatch::IntegrationTest
  test "human-created doc records human seed authorship matching owner_name" do
    post identity_path, params: { name: "Quiet Falcon" }, headers: browser
    post documents_path, params: { title: "Mine", markdown: "# Hello" }, headers: browser

    assert_response :see_other
    doc = Document.order(:created_at).last
    assert_equal "human", doc.seed_author_kind
    assert_equal "Quiet Falcon", doc.seed_author_name
    assert_equal doc.owner_name, doc.seed_author_name
  end

  test "human-created doc without a name falls back to Anonymous" do
    post documents_path, headers: browser

    assert_response :see_other
    doc = Document.order(:created_at).last
    assert_equal "human", doc.seed_author_kind
    assert_equal "Anonymous", doc.seed_author_name
  end

  private

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end
end
