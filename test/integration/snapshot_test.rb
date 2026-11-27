require "test_helper"

class SnapshotTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  PNG = Base64.decode64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ).freeze

  setup do
    @document = Document.create!(title: "Snap", content_markdown: "original")
  end

  test "snapshot with agent_name logs an agent updated_document activity" do
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "agent text"
    state_vector = Base64.strict_encode64(ydoc.encode_state_vector)

    assert_difference -> { @document.activities.count }, 1 do
      post document_snapshot_path(@document.slug), params: {
        content: "# Rewritten\n\nagent text", spans: [], state_vector:, agent_name: "  Scout  "
      }, as: :json
    end
    assert_response :success
    assert_equal 0, response.parsed_body["auto_rejected_suggestions"]
    activity = @document.activities.order(:created_at).last
    assert_equal %w[Scout agent updated_document], [ activity.actor_name, activity.actor_kind, activity.action ]
    assert_equal "Rewritten", activity.detail
  end

  test "agent snapshot auto-rejects pending suggestions whose target text vanished" do
    stale = @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "x", replaces: "original")
    kept = @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "y", replaces: "agent text")
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "agent text"
    state_vector = Base64.strict_encode64(ydoc.encode_state_vector)

    post document_snapshot_path(@document.slug), params: {
      content: "agent text", spans: [], state_vector:, agent_name: "Scout"
    }, as: :json
    assert_response :success
    assert_equal 1, response.parsed_body["auto_rejected_suggestions"]
    assert_equal "rejected", stale.reload.status
    assert_equal "pending", kept.reload.status
  end

  test "snapshot without agent_name logs no activity" do
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "human text"
    state_vector = Base64.strict_encode64(ydoc.encode_state_vector)

    assert_no_difference -> { @document.activities.count } do
      post document_snapshot_path(@document.slug), params: { content: "human text", spans: [], state_vector:, agent_name: "   " }, as: :json
    end
    assert_response :success
    assert_nil response.parsed_body["auto_rejected_suggestions"]
  end

  test "locked non-owner cannot persist a snapshot or sync update" do
    @document.update!(
      owner_token: "someone-else",
      owner_name: "Owner",
      link_access: "view",
      content_snapshot: "original"
    )
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "forbidden"
    update = Base64.strict_encode64(ydoc.encode_state_as_update)
    state_vector = Base64.strict_encode64(ydoc.encode_state_vector)

    post document_snapshot_path(@document.slug), params: {
      content: "changed", spans: [], state_vector:
    }, as: :json
    assert_response :locked
    assert_equal "original", @document.reload.content_snapshot

    post document_sync_update_path(@document.slug),
         params: { update:, generation: @document.content_generation },
         as: :json
    assert_response :locked
    assert_nil @document.reload.yjs_state
  end

  test "refused writes answer the page's request headers with 423, not a redirect" do
    suggestion = @document.suggestions.create!(author_name: "Gemini", author_kind: "ai", body: "x")
    @document.update!(
      owner_token: "someone-else",
      owner_name: "Owner",
      link_access: "view",
      content_snapshot: "original"
    )

    # Spelled out to match the page's requests: without Accept this is a redirect.
    headers = { "Content-Type" => "application/json", "Accept" => "application/json" }
    {
      document_snapshot_path(@document.slug) => [ :post, { content: "changed", spans: [] } ],
      document_sync_update_path(@document.slug) => [ :post, { update: "" } ],
      document_highlight_names_path(@document.slug) => [ :patch, { names: { yellow: "Changed" } } ],
      accept_all_document_suggestions_path(@document.slug) => [ :patch, { by: "Guest" } ],
      reopen_suggestion_path(suggestion) => [ :patch, { by: "Guest" } ]
    }.each do |path, (verb, body)|
      public_send(verb, path, params: body.to_json, headers:)
      assert_response :locked, path
      assert_equal "application/json", response.media_type, path
      assert response.parsed_body["error"].present?, path
    end

    @document.reload
    assert_equal "original", @document.content_snapshot
    assert_nil @document.yjs_state
    assert_equal "pending", suggestion.reload.status
  end

  test "sync_update stores a split edit whole and relays it in one message" do
    client = Y::Doc.new
    text = client.get_text("t")
    half = YjsPersistence::MAX_UPDATE_BYTES / 2
    text << ("a" * half)
    first = Base64.strict_encode64(client.encode_state_as_update)
    vector = client.encode_state_vector
    text << ("b" * half)
    second = Base64.strict_encode64(client.encode_state_as_update(vector))
    assert_operator Base64.strict_decode64(first).bytesize + Base64.strict_decode64(second).bytesize,
                    :>, YjsPersistence::MAX_UPDATE_BYTES

    relayed = capture_broadcasts(SyncChannel.broadcasting_for(@document)) do
      post document_sync_update_path(@document.slug),
           params: { updates: [ first, second ], cid: "x", generation: @document.content_generation },
           as: :json
    end
    assert_response :no_content
    assert_equal [ [ first, second ] ], relayed.pluck("updates")
    state, = YjsPersistence.state_b64(@document.reload)
    stored = Y::Doc.new
    stored.apply_update(Base64.strict_decode64(state))
    assert_equal ("a" * half) + ("b" * half), stored.get_text("t").to_s
  end

  test "sync_update refuses updates that fit in one update before decoding any piece" do
    client = Y::Doc.new
    text = client.get_text("t")
    text << "first "
    small_first = Base64.strict_encode64(client.encode_state_as_update)
    vector = client.encode_state_vector
    text << "second"
    small_second = Base64.strict_encode64(client.encode_state_as_update(vector))

    # Two valid pieces totaling less than one update are refused without storing or relaying.
    assert_no_broadcasts(SyncChannel.broadcasting_for(@document)) do
      post document_sync_update_path(@document.slug),
           params: { updates: [ small_first, small_second ], generation: @document.content_generation },
           as: :json
    end
    assert_response :unprocessable_entity
    assert_not @document.reload.live_crdt?

    # Two undecodable Base64 strings whose encoded lengths (less padding) total
    # exactly MAX_UPDATE_BYTES must be refused before Base64.strict_decode64 runs.
    half = YjsPersistence::MAX_UPDATE_BYTES / 2
    b64_len = ((half + 2) / 3) * 4
    pad = (3 - (half % 3)) % 3
    undecodable_half = ("!" * (b64_len - pad)) + ("=" * pad)
    assert_equal YjsPersistence::MAX_UPDATE_BYTES, ((b64_len / 4) * 3 - pad) * 2

    decoded_piece = false
    original_decode = Base64.method(:strict_decode64)
    Base64.define_singleton_method(:strict_decode64) do |value|
      decoded_piece = true if value == undecodable_half
      original_decode.call(value)
    end
    begin
      assert_no_broadcasts(SyncChannel.broadcasting_for(@document)) do
        post document_sync_update_path(@document.slug),
             params: { updates: [ undecodable_half, undecodable_half ], generation: @document.content_generation },
             as: :json
      end
      assert_response :unprocessable_entity
      assert_not decoded_piece, "updates totaling at most one update must be refused before decoding"

      # Padding a <= 2 MiB piece with EMPTY_UPDATE ('AAA=') must also be refused before decoding.
      full_b64_len = ((YjsPersistence::MAX_UPDATE_BYTES + 2) / 3) * 4
      full_pad = (3 - (YjsPersistence::MAX_UPDATE_BYTES % 3)) % 3
      undecodable_full = ("!" * (full_b64_len - full_pad)) + ("=" * full_pad)
      assert_no_broadcasts(SyncChannel.broadcasting_for(@document)) do
        post document_sync_update_path(@document.slug),
             params: {
               updates: [ undecodable_full, DocumentsController::EMPTY_UPDATE_B64 ],
               generation: @document.content_generation
             },
             as: :json
      end
      assert_response :unprocessable_entity
      assert_not decoded_piece
    ensure
      Base64.define_singleton_method(:strict_decode64, original_decode)
    end
    assert_not @document.reload.live_crdt?

    # One byte over MAX_UPDATE_BYTES crosses the threshold and is accepted.
    make_pair = lambda do |second_len|
      doc = Y::Doc.new(1)
      t = doc.get_text("t")
      t << ("a" * half)
      first_raw = doc.encode_state_as_update
      sv = doc.encode_state_vector
      t << ("b" * second_len)
      [ first_raw, doc.encode_state_as_update(sv) ]
    end
    p1_raw, p2_raw = make_pair.call(half)
    p1_raw, p2_raw = make_pair.call(half + (YjsPersistence::MAX_UPDATE_BYTES + 1) - (p1_raw.bytesize + p2_raw.bytesize))
    assert_equal YjsPersistence::MAX_UPDATE_BYTES + 1, p1_raw.bytesize + p2_raw.bytesize

    post document_sync_update_path(@document.slug),
         params: {
           updates: [ Base64.strict_encode64(p1_raw), Base64.strict_encode64(p2_raw) ],
           generation: @document.content_generation
         },
         as: :json
    assert_response :no_content
  end

  test "sync_update refuses a split edit with an oversized, malformed, missing or surplus piece" do
    client = Y::Doc.new
    client.get_text("t") << ("a" * (YjsPersistence::MAX_UPDATE_BYTES / 2 + 100))
    fits = Base64.strict_encode64(client.encode_state_as_update)
    oversized = Base64.strict_encode64("x" * (YjsPersistence::MAX_UPDATE_BYTES + 1))
    large_garbage = Base64.strict_encode64("garbage" * ((YjsPersistence::MAX_UPDATE_BYTES / 2) / 7 + 10))
    {
      [ fits, oversized ] => :content_too_large,
      [ fits ] * (YjsPersistence::MAX_SPLIT_UPDATES + 1) => :content_too_large,
      [ fits, "not-base64" ] => :unprocessable_entity,
      [ fits, large_garbage ] => :unprocessable_entity,
      [] => :unprocessable_entity
    }.each do |updates, status|
      assert_no_broadcasts(SyncChannel.broadcasting_for(@document)) do
        post document_sync_update_path(@document.slug),
             params: { updates:, generation: @document.content_generation }, as: :json
      end
      assert_response status
    end
    assert_not @document.reload.live_crdt?
  end

  test "sync_update enforces the split piece count and total byte limits before decoding" do
    assert_equal 5, YjsPersistence::MAX_SPLIT_UPDATES
    assert_equal 7.megabytes, YjsPersistence::MAX_SPLIT_UPDATE_BYTES

    # 6 pieces totaling 6 MiB (within total limit, one piece past piece limit) -> 413 before decode.
    one_mb = "!" * (((1.megabyte + 2) / 3) * 4 - 2) + "=="
    # 4 pieces totaling 7 MiB + 1 byte (within piece limit, one byte past total limit) -> 413 before decode.
    two_mb_bytes = YjsPersistence::MAX_UPDATE_BYTES
    two_mb_b64 = ("!" * (((two_mb_bytes + 2) / 3) * 4 - 1)) + "="
    tail_bytes = YjsPersistence::MAX_SPLIT_UPDATE_BYTES + 1 - (3 * two_mb_bytes)
    tail_pad = (3 - (tail_bytes % 3)) % 3
    tail_b64 = ("!" * (((tail_bytes + 2) / 3) * 4 - tail_pad)) + ("=" * tail_pad)

    decoded_any = false
    original_decode = Base64.method(:strict_decode64)
    Base64.define_singleton_method(:strict_decode64) do |value|
      decoded_any = true if value.start_with?("!")
      original_decode.call(value)
    end
    begin
      [ [ one_mb ] * 6, [ two_mb_b64, two_mb_b64, two_mb_b64, tail_b64 ] ].each do |updates|
        assert_no_broadcasts(SyncChannel.broadcasting_for(@document)) do
          post document_sync_update_path(@document.slug),
               params: { updates:, generation: @document.content_generation }, as: :json
        end
        assert_response :content_too_large
      end
      assert_not decoded_any, "oversized split requests must be refused before decoding"
    ensure
      Base64.define_singleton_method(:strict_decode64, original_decode)
    end
    assert_not @document.reload.live_crdt?
  end

  test "locked requests are denied before snapshot and sync payload validation" do
    @document.update!(
      owner_token: "someone-else",
      owner_name: "Owner",
      link_access: "view"
    )

    post document_snapshot_path(@document.slug), params: {
      content: "changed", markdown: "conflict", spans: []
    }, as: :json
    assert_response :locked

    post document_sync_update_path(@document.slug), params: { update: "not-base64" }, as: :json
    assert_response :locked
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
    state_vector = Base64.strict_encode64(Y::Doc.new.encode_state_vector)

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

  test "HTML snapshot preserves a valid sketch and exposes its semantics" do
    document = Document.create!(
      title: "HTML sketch",
      content_format: "html",
      content_snapshot: "<p>original</p>"
    )
    scene = {
      type: "excalidraw", version: 2,
      elements: [ { type: "text", text: "Review" }, { type: "rectangle" } ],
      appState: { viewBackgroundColor: "#ffffff" }, files: {}
    }.to_json
    figure = %(<figure data-thinkroom-sketch data-sketch-id="flow_1" data-format-version="1" data-description="Approval flow" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Approval flow</figcaption></figure>)

    post document_snapshot_path(document.slug), params: {
      content: "<p>Before</p>#{figure}<p>After</p>",
      spans: [],
      state_vector: Base64.strict_encode64(Y::Doc.new.encode_state_vector)
    }, as: :json

    assert_response :ok
    assert_includes document.reload.content_snapshot, "data-thinkroom-sketch"
    assert_equal "Before Sketch: Approval flow — Review After", document.plain_text
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
      state_vector: Base64.strict_encode64(Y::Doc.new.encode_state_vector)
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
           state_vector: Base64.strict_encode64(Y::Doc.new.encode_state_vector)
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
    update = Base64.strict_encode64(ydoc.encode_state_as_update)
    state_vector = Base64.strict_encode64(ydoc.encode_state_vector)

    assert_broadcast_on(
      SyncChannel.broadcasting_for(@document),
      type: "update", update:, cid: "browser-1"
    ) do
      post document_sync_update_path(@document.slug),
           params: {
             update:, cid: "browser-1", generation: @document.content_generation,
             content: "* [x] checked", spans: [], state_vector:
           },
           as: :json
    end

    assert_response :no_content
    full_state, = YjsPersistence.state_b64(@document.reload)
    persisted = Y::Doc.new
    persisted.apply_update(Base64.strict_decode64(full_state))
    assert_equal "checked", persisted.get_text("task").to_s
    assert_equal "* [x] checked", @document.content_snapshot
  end

  test "durable sync update rejects a stale generation instead of resurrecting replaced content" do
    @document.update!(seed_content: "# Seed", content_snapshot: nil)
    stale_generation = @document.content_generation

    # A still-open tab's local Yjs doc predates an owner CLI replacement.
    @document.replace_content!(source: "# Replacement")
    assert_equal stale_generation + 1, @document.reload.content_generation

    ydoc = Y::Doc.new
    ydoc.get_text("t") << "resurrected stale content"
    update = Base64.strict_encode64(ydoc.encode_state_as_update)

    assert_no_broadcasts(SyncChannel.broadcasting_for(@document)) do
      post document_sync_update_path(@document.slug),
           params: { update:, generation: stale_generation },
           as: :json
    end

    assert_response :conflict
    assert_nil @document.reload.yjs_state,
               "a stale-generation keepalive request must never resurrect content a replacement reset"
  end

  test "durable sync update with the current generation persists normally" do
    @document.update!(seed_content: "# Seed", content_snapshot: nil)
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "current content"
    update = Base64.strict_encode64(ydoc.encode_state_as_update)

    post document_sync_update_path(@document.slug),
         params: { update:, generation: @document.content_generation },
         as: :json

    assert_response :no_content
    assert @document.reload.yjs_document_updates.exists?
  end

  test "durable sync update rejects missing, nil, and malformed generation with 409 conflict" do
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "legacy client, no generation field"
    update = Base64.strict_encode64(ydoc.encode_state_as_update)

    [
      { update: },
      { update:, generation: nil },
      { update:, generation: "not-an-int" }
    ].each do |params|
      assert_no_broadcasts(SyncChannel.broadcasting_for(@document)) do
        post document_sync_update_path(@document.slug), params:, as: :json
      end
      assert_response :conflict
    end

    assert_not @document.reload.yjs_document_updates.exists?
  end

  test "durable sync update rejects malformed and oversized payloads" do
    post document_sync_update_path(@document.slug),
         params: { update: "not-base64", generation: @document.content_generation },
         as: :json
    assert_response :unprocessable_entity
    assert_nil @document.reload.yjs_state

    # Invalid base64 past the pre-decode cap must return 413 (not 422), proving
    # the size firewall rejects before Base64.strict_decode64 allocates.
    pre_decode_oversized = "!" * (DocumentsController::MAX_SYNC_UPDATE_B64_BYTES + 1)
    post document_sync_update_path(@document.slug),
         params: { update: pre_decode_oversized, generation: @document.content_generation },
         as: :json
    assert_response :content_too_large
    assert_nil @document.reload.yjs_state

    oversized = Base64.strict_encode64("x" * (DocumentsController::MAX_SYNC_UPDATE_BYTES + 1))
    post document_sync_update_path(@document.slug),
         params: { update: oversized, generation: @document.content_generation },
         as: :json
    assert_response :content_too_large
    assert_nil @document.reload.yjs_state

    undecodable = Base64.strict_encode64("yrs-garbage-bytes")
    post document_sync_update_path(@document.slug),
         params: { update: undecodable, generation: @document.content_generation },
         as: :json
    assert_response :unprocessable_entity
    assert_not @document.reload.yjs_document_updates.exists?
  end
end
