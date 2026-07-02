require "test_helper"

class YjsPersistenceTest < ActiveSupport::TestCase
  def b64_update_for(text, from_doc: nil)
    ydoc = from_doc || Y::Doc.new
    ytext = ydoc.get_text("t")
    ytext << text
    Base64.strict_encode64(ydoc.diff.pack("C*"))
  end

  def text_of(document)
    ydoc = Y::Doc.new
    ydoc.sync(document.yjs_state.unpack("C*"))
    ydoc.get_text("t").to_s
  end

  test "merge persists an update and survives reload" do
    doc = Document.create!(title: "Sync")
    YjsPersistence.merge(doc, b64_update_for("hello"))

    assert doc.reload.yjs_state.present?
    assert_equal "hello", text_of(doc)
  end

  test "merging updates from two independent clients keeps both edits" do
    doc = Document.create!(title: "Converge")

    YjsPersistence.merge(doc, b64_update_for("from client A. "))
    YjsPersistence.merge(doc, b64_update_for("from client B."))

    merged = text_of(doc.reload)
    assert_includes merged, "from client A"
    assert_includes merged, "from client B"
  end

  test "concurrent merges do not lose updates" do
    doc = Document.create!(title: "Race")
    updates = 8.times.map { |i| b64_update_for("edit#{i};") }

    threads = updates.map do |update|
      Thread.new { YjsPersistence.merge(Document.find(doc.id), update) }
    end
    threads.each(&:join)

    merged = text_of(doc.reload)
    8.times { |i| assert_includes merged, "edit#{i};" }
  end

  test "merge marks the document seeded" do
    doc = Document.create!(title: "Seedable", seed_markdown: "# Hi")
    assert_equal "pending", doc.seed_state

    YjsPersistence.merge(doc, b64_update_for("seeded content"))
    assert_equal "seeded", doc.reload.seed_state
  end


  test "a no-op update does not persist or flip seed_state" do
    doc = Document.create!(title: "Unseeded", seed_markdown: "# Template")

    # The empty sync-reply a client sends when joining an empty doc.
    empty_update = Base64.strict_encode64(Y::Doc.new.full_diff.pack("C*"))
    YjsPersistence.merge(doc, empty_update)

    doc.reload
    assert_equal "pending", doc.seed_state, "no-op merge must not mark the doc seeded"
    assert_not doc.yjs_state.present?, "no-op merge must not persist state"
  end

  test "merge rejects a frame whose generation is behind the document's current one" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("live editor content"))
    stale_generation = doc.content_generation
    doc.replace_content!(source: "# Replacement")
    assert_equal stale_generation + 1, doc.reload.content_generation

    assert_raises(Document::StaleGenerationError) do
      YjsPersistence.merge(doc, b64_update_for("resurrected stale content"), generation: stale_generation)
    end

    assert_nil doc.reload.yjs_state, "a rejected stale frame must not resurrect yjs_state"
  end

  test "merge accepts a frame whose generation matches the document's current one" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("current content"), generation: doc.content_generation)

    assert doc.reload.yjs_state.present?
    assert_equal "current content", text_of(doc)
  end

  test "merge trusts a frame with no generation (rollout compatibility)" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    doc.replace_content!(source: "# Replacement")

    YjsPersistence.merge(doc, b64_update_for("no generation sent"), generation: nil)

    assert doc.reload.yjs_state.present?, "a frame with no generation key must still merge, matching pre-existing behavior"
  end

  test "corrupt base64 raises and leaves the document untouched" do
    doc = Document.create!(title: "Corrupt")
    YjsPersistence.merge(doc, b64_update_for("good content"))
    before = doc.reload.yjs_state

    assert_raises(ArgumentError) { YjsPersistence.merge(doc, "not!!base64!!") }
    assert_equal before, doc.reload.yjs_state
  end

  test "state_b64 round-trips through a fresh client doc" do
    doc = Document.create!(title: "Handshake")
    YjsPersistence.merge(doc, b64_update_for("server content"))

    full_state, state_vector = YjsPersistence.state_b64(doc.reload)
    assert state_vector.present?

    client = Y::Doc.new
    client.sync(Base64.strict_decode64(full_state).unpack("C*"))
    assert_equal "server content", client.get_text("t").to_s
  end

  test "snapshot persistence rejects a client behind the current Yjs state" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    stale_vector = Base64.strict_encode64(Y::Doc.new.state.pack("C*"))

    persisted = YjsPersistence.persist_snapshot(
      doc,
      state_vector_b64: stale_vector,
      content: "stale",
      spans: [],
      title: "Stale title"
    )

    assert_not persisted
    assert_equal "current", doc.reload.content_snapshot
    assert_equal "Snapshot", doc.title
  end

  test "snapshot persistence accepts clients at or ahead of the server state" do
    doc = Document.create!(title: "Snapshot")
    client = Y::Doc.new
    YjsPersistence.merge(doc, b64_update_for("server content", from_doc: client))
    client.get_text("t") << " client content"
    client_vector = Base64.strict_encode64(client.state.pack("C*"))

    persisted = YjsPersistence.persist_snapshot(
      doc,
      state_vector_b64: client_vector,
      content: "new source",
      spans: [],
      title: "New title"
    )

    assert persisted
    assert_equal "new source", doc.reload.content_snapshot
    assert_equal "New title", doc.title
  end

  test "snapshot persistence accepts reordered multi-client state vectors" do
    doc = Document.create!(title: "Snapshot")
    YjsPersistence.merge(doc, b64_update_for("client one"))
    YjsPersistence.merge(doc, b64_update_for("client two"))

    server = Y::Doc.new
    server.sync(doc.reload.yjs_state.unpack("C*"))
    entries = decode_state_vector_for_test(server.state).to_a.reverse
    reordered = encode_state_vector_for_test(entries)

    persisted = YjsPersistence.persist_snapshot(
      doc,
      state_vector_b64: Base64.strict_encode64(reordered.pack("C*")),
      content: "ordered independently",
      spans: []
    )

    assert persisted
    assert_equal "ordered independently", doc.reload.content_snapshot
  end

  test "merge emits a merged event with byte sizes" do
    doc = Document.create!(title: "Metered")
    events = capture_yjs_events("merge.yjs") do
      YjsPersistence.merge(doc, b64_update_for("measured content"))
    end

    assert_equal 1, events.length
    payload = events.first.payload
    assert_equal doc.id, payload[:document_id]
    assert_equal "merged", payload[:outcome]
    assert_operator payload[:update_bytes], :>, 0
    assert_equal 0, payload[:blob_bytes_before]
    assert_operator payload[:blob_bytes_after], :>, 0
    assert payload.key?(:lock_wait_ms)
  end

  test "a no-op merge emits a noop event" do
    doc = Document.create!(title: "Noop", seed_markdown: "# Template")
    empty_update = Base64.strict_encode64(Y::Doc.new.full_diff.pack("C*"))

    events = capture_yjs_events("merge.yjs") { YjsPersistence.merge(doc, empty_update) }

    assert_equal "noop", events.first.payload[:outcome]
  end

  test "a stale-generation rejection emits a rejected_stale event and still raises" do
    doc = Document.create!(title: "Stale", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("live"))
    stale_generation = doc.content_generation
    doc.replace_content!(source: "# Replacement")

    events = capture_yjs_events("merge.yjs") do
      assert_raises(Document::StaleGenerationError) do
        YjsPersistence.merge(doc, b64_update_for("stale"), generation: stale_generation)
      end
    end

    assert_equal "rejected_stale", events.first.payload[:outcome]
  end

  test "a locked rejection emits a rejected_locked event and still raises" do
    doc = Document.create!(title: "Locked", owner_token: "owner", owner_name: "O", link_access: "view")

    events = capture_yjs_events("merge.yjs") do
      assert_raises(Document::EditingLockedError) do
        YjsPersistence.merge(doc, b64_update_for("forbidden"))
      end
    end

    assert_equal "rejected_locked", events.first.payload[:outcome]
  end

  test "state_b64 emits a state event with the stored blob size" do
    doc = Document.create!(title: "Join")
    YjsPersistence.merge(doc, b64_update_for("content"))
    doc.reload

    events = capture_yjs_events("state.yjs") { YjsPersistence.state_b64(doc) }

    assert_equal doc.yjs_state.bytesize, events.first.payload[:blob_bytes]
  end

  test "snapshot outcomes are taxonomized in events" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    stale_vector = Base64.strict_encode64(Y::Doc.new.state.pack("C*"))

    events = capture_yjs_events("snapshot.yjs") do
      YjsPersistence.persist_snapshot(doc, state_vector_b64: stale_vector, content: "stale", spans: [])
    end
    assert_equal "rejected_stale_vector", events.first.payload[:outcome]

    events = capture_yjs_events("snapshot.yjs") do
      YjsPersistence.persist_snapshot(doc, state_vector_b64: nil, content: "fresh", spans: [])
    end
    assert_equal "persisted", events.first.payload[:outcome]
  end

  test "an undecodable state vector emits invalid_state_vector, logs, and returns false" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    garbage_vector = Base64.strict_encode64([ 0x85, 0xff, 0xff ].pack("C*"))

    logged = capture_rails_log do
      events = capture_yjs_events("snapshot.yjs") do
        persisted = YjsPersistence.persist_snapshot(
          doc, state_vector_b64: garbage_vector, content: "corrupt", spans: []
        )
        assert_not persisted
      end
      assert_equal "invalid_state_vector", events.first.payload[:outcome]
    end

    assert_includes logged, "invalid state vector"
    assert_includes logged, doc.id.to_s
    assert_equal "current", doc.reload.content_snapshot
  end

  private

  def capture_yjs_events(name)
    events = []
    subscription = ActiveSupport::Notifications.subscribe(name) do |event|
      events << event
    end
    yield
    events
  ensure
    ActiveSupport::Notifications.unsubscribe(subscription)
  end

  def capture_rails_log
    io = StringIO.new
    original = Rails.logger
    Rails.logger = ActiveSupport::TaggedLogging.new(Logger.new(io))
    yield
    io.string
  ensure
    Rails.logger = original
  end

  def decode_state_vector_for_test(bytes)
    index = 0
    read = lambda do
      value = 0
      shift = 0
      loop do
        byte = bytes.fetch(index)
        index += 1
        value |= (byte & 0x7f) << shift
        break value if (byte & 0x80).zero?
        shift += 7
      end
    end
    read.call.times.to_h { [ read.call, read.call ] }
  end

  def encode_state_vector_for_test(entries)
    values = [ entries.length, *entries.flatten ]
    values.flat_map do |value|
      encoded = []
      loop do
        byte = value & 0x7f
        value >>= 7
        encoded << (value.zero? ? byte : byte | 0x80)
        break if value.zero?
      end
      encoded
    end
  end
end
