require "test_helper"

class SnapshotTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  PNG = Base64.decode64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ).freeze

  setup do
    @document = Document.create!(title: "Snap", content_markdown: "original")
  end

  test "persists markdown and sanitized spans" do
    assert_broadcast_on(
      DocumentMetaChannel.broadcasting_for(@document),
      event: "title", title: "Updated"
    ) do
      post document_snapshot_path(@document.slug), params: {
        markdown: "# Updated",
        spans: [
          { kind: "human", author: "A", state: "verbatim", chars: 9, text: "# Updated" },
          { kind: "ai", author: "Gemini", state: "pending", chars: 4, text: "tail", extra: "dropped" }
        ]
      }, as: :json
    end

    assert_response :ok
    @document.reload
    assert_equal "# Updated", @document.content_markdown
    assert_equal "Updated", @document.title
    assert_equal 2, @document.provenance_spans.length
    assert_not @document.provenance_spans.last.key?("extra"), "unpermitted keys must be stripped"
  end

  test "oversized markdown is rejected without mutating the document" do
    post document_snapshot_path(@document.slug), params: {
      markdown: "x" * (DocumentsController::MAX_SNAPSHOT_BYTES + 1),
      spans: []
    }, as: :json

    assert_response :content_too_large
    assert_equal "original", @document.reload.content_markdown
  end

  test "HTML snapshot is sanitized while valid review metadata survives" do
    document = Document.create!(
      title: "HTML",
      content_format: "html",
      content_snapshot: "<p>original</p>"
    )
    state_vector = Base64.strict_encode64(Y::Doc.new.state.pack("C*"))

    post document_snapshot_path(document.slug), params: {
      content: '<p onclick="bad()">Safe ' \
               '<span data-provenance data-kind="ai" data-author="Scout" data-state="pending">draft</span>' \
               '<del data-suggestion-id="s1" data-author="Kieran">old</del>' \
               "<script>alert(1)</script></p>",
      spans: [],
      state_vector:
    }, as: :json

    assert_response :ok
    assert response.parsed_body["normalized"]
    content = document.reload.content_snapshot
    assert_includes content, "data-provenance"
    assert_includes content, 'data-suggestion-id="s1"'
    refute_match(/onclick|script/, content)
  end

  test "HTML snapshot claims an image uploaded by the browser API" do
    upload = Tempfile.new([ "snapshot-image", ".png" ])
    upload.binmode
    upload.write(PNG)
    upload.rewind
    post "/api/uploads",
         params: {
           file: Rack::Test::UploadedFile.new(
             upload.path,
             "image/png",
             original_filename: "snapshot.png"
           )
         },
         headers: { "X-Agent-Name" => "Quiet Falcon", "REMOTE_ADDR" => "192.0.2.240" }
    src = response.parsed_body.fetch("src")
    asset = DocumentAsset.last
    document = Document.create!(
      title: "HTML upload",
      content_format: "html",
      content_snapshot: "<p>original</p>"
    )

    post document_snapshot_path(document.slug), params: {
      content: %(<p><img src="#{src}" alt="Snapshot"></p>),
      spans: [],
      state_vector: Base64.strict_encode64(Y::Doc.new.state.pack("C*"))
    }, as: :json

    assert_response :ok
    assert_equal document, asset.reload.document
  ensure
    upload&.close!
  end

  test "snapshot rejects conflicting generic and legacy source fields" do
    post document_snapshot_path(@document.slug),
         params: { content: "generic", markdown: "legacy" },
         as: :json

    assert_response :unprocessable_entity
    assert_equal "original", @document.reload.content_snapshot
  end

  test "HTML snapshot rejects the legacy markdown field" do
    document = Document.create!(
      title: "HTML",
      content_format: "html",
      content_snapshot: "<p>original</p>"
    )

    post document_snapshot_path(document.slug),
         params: {
           markdown: "<p>wrong field</p>",
           spans: [],
           state_vector: Base64.strict_encode64(Y::Doc.new.state.pack("C*"))
         },
         as: :json

    assert_response :unprocessable_entity
    assert_equal "<p>original</p>", document.reload.content_snapshot
  end

  test "HTML snapshot requires a state vector" do
    document = Document.create!(
      title: "HTML",
      content_format: "html",
      content_snapshot: "<p>original</p>"
    )

    post document_snapshot_path(document.slug),
         params: { content: "<p>new</p>", spans: [] },
         as: :json

    assert_response :unprocessable_entity
    assert_equal "<p>original</p>", document.reload.content_snapshot
  end

  test "invalid and non-hash span entries are dropped" do
    post document_snapshot_path(@document.slug), params: {
      markdown: "ok",
      spans: [
        "not-a-span",
        { kind: "owner", state: "endorsed", chars: 2 },
        { kind: "human", state: "verbatim", chars: -1 },
        { kind: "human", state: "verbatim", chars: 2, text: "ok" }
      ]
    }, as: :json

    assert_response :ok
    assert_equal 1, @document.reload.provenance_spans.length
  end

  test "durable sync update persists and broadcasts the Yjs diff" do
    ydoc = Y::Doc.new
    ydoc.get_text("task") << "checked"
    update = Base64.strict_encode64(ydoc.diff.pack("C*"))
    state_vector = Base64.strict_encode64(ydoc.state.pack("C*"))

    assert_broadcast_on(
      SyncChannel.broadcasting_for(@document),
      type: "update", update:, cid: "browser-1"
    ) do
      post document_sync_update_path(@document.slug),
           params: {
             update:, cid: "browser-1", content: "* [x] checked",
             spans: [], state_vector:
           },
           as: :json
    end

    assert_response :no_content
    persisted = Y::Doc.new
    persisted.sync(@document.reload.yjs_state.unpack("C*"))
    assert_equal "checked", persisted.get_text("task").to_s
    assert_equal "* [x] checked", @document.content_snapshot
  end

  test "durable sync update rejects malformed and oversized payloads" do
    post document_sync_update_path(@document.slug),
         params: { update: "not-base64" },
         as: :json
    assert_response :unprocessable_entity
    assert_nil @document.reload.yjs_state

    oversized = Base64.strict_encode64("x" * (DocumentsController::MAX_SYNC_UPDATE_BYTES + 1))
    post document_sync_update_path(@document.slug),
         params: { update: oversized },
         as: :json
    assert_response :content_too_large
    assert_nil @document.reload.yjs_state
  end
end
