require "test_helper"

# UI-created documents record seed authorship at the same INSERT that claims
# ownership: kind "human", name matching the owner attribution. The agent API
# counterpart (agent kind, header-derived name) is covered in agent_api_test.
class DocumentCreateTest < ActionDispatch::IntegrationTest
  test "human-created doc records human seed authorship matching owner_name" do
    post identity_path, params: { name: "Quiet Falcon" }, headers: browser
    post documents_path, params: { title: "Mine", markdown: "# Hello" }, headers: browser

    assert_response :redirect
    doc = Document.order(:created_at).last
    assert_equal "human", doc.seed_author_kind
    assert_equal "Quiet Falcon", doc.seed_author_name
    assert_equal doc.owner_name, doc.seed_author_name
    assert_redirected_to document_mode_path(doc.slug, "edit")
  end

  test "human-created doc without a name falls back to Anonymous" do
    post documents_path, headers: browser

    assert_response :see_other
    doc = Document.order(:created_at).last
    assert_equal "human", doc.seed_author_kind
    assert_equal "Anonymous", doc.seed_author_name
  end

  test "browser creation stays Markdown when an HTML format is requested" do
    post documents_path, params: { content_format: "html" }, headers: browser

    assert_response :see_other
    doc = Document.order(:created_at).last
    assert_equal "markdown", doc.content_format
    assert_equal Document::DEFAULT_SEED, doc.seed_content
  end

  test "browser creation ignores unknown format parameters" do
    post documents_path, params: { content_format: "xml" }, headers: browser

    assert_response :see_other
    assert_equal "markdown", Document.order(:created_at).last.content_format
  end

  private

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end
end
