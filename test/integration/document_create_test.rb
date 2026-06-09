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
  end

  test "human-created doc without a name falls back to Anonymous" do
    post documents_path, headers: browser

    assert_response :see_other
    doc = Document.order(:created_at).last
    assert_equal "human", doc.seed_author_kind
    assert_equal "Anonymous", doc.seed_author_name
  end

  test "human can create an HTML document with the HTML default seed" do
    post documents_path, params: { content_format: "html" }, headers: browser

    assert_response :see_other
    doc = Document.order(:created_at).last
    assert_equal "html", doc.content_format
    assert_equal Document::DEFAULT_HTML_SEED, doc.seed_content
  end

  test "unknown human format does not create a document" do
    assert_no_difference -> { Document.count } do
      post documents_path, params: { content_format: "xml" }, headers: browser
    end

    assert_response :redirect
    assert_equal "Choose Markdown or HTML", session[:inertia_errors][:content_format]
  end

  private

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end
end
