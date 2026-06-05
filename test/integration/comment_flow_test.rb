require "test_helper"

class CommentFlowTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    @document = Document.create!(title: "Doc")
  end

  test "creating a comment anchors it, logs activity, and broadcasts" do
    assert_difference -> { @document.comments.open.count }, 1 do
      assert_difference -> { @document.activities.count }, 1 do
        post document_comments_path(@document.slug), params: {
          body: "This needs a citation.",
          anchor_text: "provenance",
          author_name: "Quiet Falcon"
        }
      end
    end

    comment = @document.comments.last
    assert_equal "human", comment.author_kind
    assert_equal "provenance", comment.anchor_text
    assert_equal "commented", @document.activities.last.action
  end

  test "comment creation broadcasts a comments event" do
    assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 2) do
      post document_comments_path(@document.slug), params: { body: "Hello", author_name: "A" }
    end
  end

  test "blank body is rejected with an error" do
    assert_no_difference -> { @document.comments.count } do
      post document_comments_path(@document.slug), params: { body: "", author_name: "A" }
    end
    assert_response :redirect
  end

  test "resolving a comment timestamps it and keeps it out of open scope" do
    comment = @document.comments.create!(author_name: "A", author_kind: "human", body: "Fix this")

    patch resolve_comment_path(comment), params: { by: "Quiet Falcon" }

    assert comment.reload.resolved_at.present?
    assert_empty @document.comments.open
    assert_equal "resolved_comment", @document.activities.last.action
  end

  test "agent comments keep agent attribution" do
    comment = @document.comments.create!(author_name: "Scout", author_kind: "agent", body: "From the API")
    assert_equal "agent", comment.as_props[:author_kind]
  end
end

class ThemePersistenceTest < ActionDispatch::IntegrationTest
  test "layout renders the persisted theme from the cookie" do
    doc = Document.create!(title: "Themed")
    get document_page_path(doc.slug),
        headers: { "User-Agent" => "Mozilla/5.0", "Cookie" => "proof_theme=whitey" }
    assert_includes response.body, 'data-theme="whitey"'
  end

  test "unknown theme cookie values fall back to the default" do
    doc = Document.create!(title: "Themed")
    get document_page_path(doc.slug),
        headers: { "User-Agent" => "Mozilla/5.0", "Cookie" => "proof_theme=evil" }
    assert_includes response.body, 'data-theme="proof"'
  end
end
