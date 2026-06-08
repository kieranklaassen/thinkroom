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

  test "resolving a nonexistent comment redirects back with an error instead of 404ing" do
    # An optimistic (not-yet-reconciled) client id or a deleted comment must
    # not raise a 404 modal over the editor.
    patch resolve_comment_path(-42), params: { by: "Quiet Falcon" }

    # 302, not 303: error-bag redirects carry no explicit status so the
    # InertiaRails middleware preserves the staged errors (it deletes them on
    # anything but 301/302, and upgrades Inertia non-GET redirects itself).
    assert_response :redirect
    # The errors bag must carry the message — the client's onError path (and
    # optimistic revert) depends on it being present on the follow-up render.
    assert_equal "is no longer available", session[:inertia_errors][:comment]
  end

  test "resolving an already-resolved comment re-stamps but does not reopen it" do
    comment = @document.comments.create!(author_name: "A", author_kind: "human", body: "Fix this")

    patch resolve_comment_path(comment), params: { by: "B" }
    first_resolved_at = comment.reload.resolved_at
    patch resolve_comment_path(comment), params: { by: "C" }

    assert_response :see_other
    assert comment.reload.resolved_at.present?
    assert_empty @document.comments.open
    # The second resolve re-stamps but never un-resolves; both are accepted.
    assert_operator comment.resolved_at, :>=, first_resolved_at
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
