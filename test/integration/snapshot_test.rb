require "test_helper"

class SnapshotTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Snap", content_markdown: "original")
  end

  test "persists markdown and sanitized spans" do
    post document_snapshot_path(@document.slug), params: {
      markdown: "# Updated",
      spans: [
        { kind: "human", author: "A", state: "verbatim", chars: 9, text: "# Updated" },
        { kind: "ai", author: "Gemini", state: "pending", chars: 4, text: "tail", extra: "dropped" }
      ]
    }, as: :json

    assert_response :ok
    @document.reload
    assert_equal "# Updated", @document.content_markdown
    assert_equal 2, @document.provenance_spans.length
    assert_not @document.provenance_spans.last.key?("extra"), "unpermitted keys must be stripped"
  end

  test "oversized markdown is rejected without mutating the document" do
    post document_snapshot_path(@document.slug), params: {
      markdown: "x" * (DocumentsController::MAX_SNAPSHOT_BYTES + 1),
      spans: []
    }, as: :json

    assert_response :payload_too_large
    assert_equal "original", @document.reload.content_markdown
  end

  test "non-hash span entries are dropped" do
    post document_snapshot_path(@document.slug), params: {
      markdown: "ok",
      spans: [ "not-a-span", { kind: "human", chars: 2 } ]
    }, as: :json

    assert_response :ok
    assert_equal 1, @document.reload.provenance_spans.length
  end
end
