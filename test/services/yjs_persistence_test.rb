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

  test "merge persists the state vector alongside the blob" do
    doc = Document.create!(title: "Vectored")
    YjsPersistence.merge(doc, b64_update_for("content"))
    doc.reload

    assert doc.yjs_state_vector.present?
    ydoc = Y::Doc.new
    ydoc.sync(doc.yjs_state.unpack("C*"))
    assert_equal ydoc.state, doc.yjs_state_vector.unpack("C*")
  end

  test "state_b64 serves the handshake from columns without building a doc" do
    doc = Document.create!(title: "Fast join")
    YjsPersistence.merge(doc, b64_update_for("column served"))
    doc.reload

    event = nil
    original = Y::Doc.method(:new)
    Y::Doc.define_singleton_method(:new) { |*| raise "state_b64 must not build a Y::Doc" }
    begin
      event = assert_notification("state.yjs", served_from: "columns") do
        full_state, state_vector = YjsPersistence.state_b64(doc)
        assert_equal Base64.strict_encode64(doc.yjs_state), full_state
        assert_equal Base64.strict_encode64(doc.yjs_state_vector), state_vector
      end
    ensure
      Y::Doc.define_singleton_method(:new, original)
    end

    client = Y::Doc.new
    client.sync(doc.yjs_state.unpack("C*"))
    assert_equal "column served", client.get_text("t").to_s
    assert_equal "ok", event.payload[:outcome]
  end

  test "a legacy row without a stored vector falls back to rebuilding" do
    doc = Document.create!(title: "Legacy")
    YjsPersistence.merge(doc, b64_update_for("old row"))
    doc.update_columns(yjs_state_vector: nil)
    doc.reload

    full_state, state_vector = nil, nil
    assert_notification("state.yjs", served_from: "rebuild") do
      full_state, state_vector = YjsPersistence.state_b64(doc)
    end

    client = Y::Doc.new
    client.sync(Base64.strict_decode64(full_state).unpack("C*"))
    assert_equal "old row", client.get_text("t").to_s
    assert state_vector.present?
  end

  test "replace_content! clears the stored state vector until the next merge" do
    doc = Document.create!(title: "Reset", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("live"))
    assert doc.reload.yjs_state_vector.present?

    doc.replace_content!(source: "# Replacement")
    assert_nil doc.reload.yjs_state_vector

    YjsPersistence.merge(doc, b64_update_for("fresh"))
    assert doc.reload.yjs_state_vector.present?
  end

  test "the snapshot staleness gate reads the stored vector without building a doc" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    stale_vector = Base64.strict_encode64(Y::Doc.new.state.pack("C*"))

    original = YjsPersistence.singleton_class.instance_method(:load_ydoc)
    YjsPersistence.define_singleton_method(:load_ydoc) { |*| raise "gate must not build a Y::Doc" }
    begin
      persisted = YjsPersistence.persist_snapshot(
        doc.reload, state_vector_b64: stale_vector, content: "stale", spans: []
      )
      assert_not persisted
    ensure
      YjsPersistence.singleton_class.define_method(:load_ydoc, original)
    end

    assert_equal "current", doc.reload.content_snapshot
  end

  test "a corrupt stored vector falls back to the blob for the snapshot gate" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    client = Y::Doc.new
    YjsPersistence.merge(doc, b64_update_for("server content", from_doc: client))
    doc.update_columns(yjs_state_vector: [ 0x85, 0xff ].pack("C*"))

    stale_vector = Base64.strict_encode64(Y::Doc.new.state.pack("C*"))
    assert_not YjsPersistence.persist_snapshot(
      doc.reload, state_vector_b64: stale_vector, content: "stale", spans: []
    ), "a behind client must still be rejected when the stored vector is corrupt"

    current_vector = Base64.strict_encode64(client.state.pack("C*"))
    assert YjsPersistence.persist_snapshot(
      doc.reload, state_vector_b64: current_vector, content: "fresh", spans: []
    ), "a current client must still be accepted when the stored vector is corrupt"
    assert_equal "fresh", doc.reload.content_snapshot
  end

  test "snapshot staleness gate works from a legacy row without a stored vector" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    doc.update_columns(yjs_state_vector: nil)
    stale_vector = Base64.strict_encode64(Y::Doc.new.state.pack("C*"))

    persisted = YjsPersistence.persist_snapshot(
      doc.reload, state_vector_b64: stale_vector, content: "stale", spans: []
    )

    assert_not persisted
    assert_equal "current", doc.reload.content_snapshot
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

  test "a second merge reuses the resident doc without reloading the blob" do
    doc = Document.create!(title: "Resident")
    client = Y::Doc.new
    assert_notification("merge.yjs", cache: "miss") do
      YjsPersistence.merge(doc, b64_update_for("first ", from_doc: client))
    end

    original = YjsPersistence.singleton_class.instance_method(:load_ydoc)
    YjsPersistence.define_singleton_method(:load_ydoc) { |*| raise "cache hit must not reload" }
    begin
      assert_notification("merge.yjs", cache: "hit") do
        YjsPersistence.merge(doc, b64_update_for("second", from_doc: client))
      end
    ensure
      YjsPersistence.singleton_class.define_method(:load_ydoc, original)
    end

    assert_equal "first second", text_of(doc.reload)
  end

  test "an external blob write invalidates the resident doc" do
    doc = Document.create!(title: "Externally written")
    YjsPersistence.merge(doc, b64_update_for("cached content. "))

    # Another writer (e.g. a different process) replaces the blob directly.
    external = Y::Doc.new
    external.get_text("t") << "external content. "
    doc.reload.update_columns(
      yjs_state: external.full_diff.pack("C*"),
      yjs_state_vector: external.state.pack("C*")
    )

    assert_notification("merge.yjs", cache: "miss") do
      YjsPersistence.merge(doc.reload, b64_update_for("appended."))
    end

    merged = text_of(doc.reload)
    assert_includes merged, "external content", "the digest check must force a fresh load"
    assert_includes merged, "appended"
    assert_not_includes merged, "cached content", "the stale resident doc must not win"
  end

  test "replace_content! invalidates the resident doc via the generation" do
    doc = Document.create!(title: "Regenerated", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("old generation secret"))
    doc.replace_content!(source: "# Replacement")

    assert_notification("merge.yjs", cache: "miss") do
      YjsPersistence.merge(doc.reload, b64_update_for("new generation"))
    end

    merged = text_of(doc.reload)
    assert_not_includes merged, "old generation secret",
                        "a resident doc from a wiped generation must never persist"
    assert_includes merged, "new generation"
  end

  test "an out-of-order dependent pair converges on redelivery, matching pre-cache behavior" do
    doc = Document.create!(title: "Pending")
    client = Y::Doc.new
    text = client.get_text("t")
    text << "a"
    first = client.diff
    first_state = client.state
    text << "b"
    second = client.diff(first_state)

    # Dependent frame first: y-rb does not retry pending structs across
    # syncs, so this is a no-op — nothing persists, nothing corrupts.
    assert_notification("merge.yjs", outcome: "noop") do
      YjsPersistence.merge(doc, Base64.strict_encode64(second.pack("C*")))
    end
    assert_nil doc.reload.yjs_state

    YjsPersistence.merge(doc, Base64.strict_encode64(first.pack("C*")))
    # The client's next sync-reply re-delivers the dependent frame (the
    # channel's seq buffer prevents this ordering for cable traffic anyway).
    YjsPersistence.merge(doc, Base64.strict_encode64(second.pack("C*")))

    assert_equal "ab", text_of(doc.reload)
  end

  test "the resident cache is bounded by an LRU cap and hits refresh recency" do
    docs = YjsPersistence::MAX_RESIDENT_DOCS.times.map { |i| Document.create!(title: "LRU #{i}") }
    clients = docs.map do |d|
      client = Y::Doc.new
      YjsPersistence.merge(d, b64_update_for("x", from_doc: client))
      client
    end

    # A hit on the oldest entry refreshes its recency...
    YjsPersistence.merge(docs.first, b64_update_for("y", from_doc: clients.first))

    # ...so the overflow evicts the now-oldest second entry instead.
    overflow = Document.create!(title: "LRU overflow")
    YjsPersistence.merge(overflow, b64_update_for("x"))

    assert YjsPersistence.resident?(docs.first.id), "a recently-hit entry must survive"
    assert_not YjsPersistence.resident?(docs[1].id), "the least-recently-used entry must evict"
    assert YjsPersistence.resident?(overflow.id)
  end

  test "a failed persist evicts the resident doc so redelivery lands" do
    doc = Document.create!(title: "Failed persist")
    client = Y::Doc.new
    YjsPersistence.merge(doc, b64_update_for("kept. ", from_doc: client))
    update = b64_update_for("nearly lost", from_doc: client)

    doc.define_singleton_method(:update_columns) { |*| raise ActiveRecord::StatementInvalid, "disk I/O error" }
    begin
      assert_raises(ActiveRecord::StatementInvalid) { YjsPersistence.merge(doc, update) }
    ensure
      doc.singleton_class.send(:remove_method, :update_columns)
    end
    assert_not YjsPersistence.resident?(doc.id), "a doc ahead of the DB must not stay cached"

    # The client redelivers the same frame (seq buffer / sync-reply): it must
    # miss the cache, reload from the stored blob, and actually persist.
    assert_notification("merge.yjs", cache: "miss", outcome: "merged") do
      YjsPersistence.merge(doc.reload, update)
    end
    assert_includes text_of(doc.reload), "nearly lost"
  end

  test "release evicts the resident doc and an unlocked mutex" do
    doc = Document.create!(title: "Released")
    YjsPersistence.merge(doc, b64_update_for("resident"))
    assert YjsPersistence.resident?(doc.id)
    assert YjsPersistence::LOCKS.key?(doc.id)

    YjsPersistence.release(doc.id)

    assert_not YjsPersistence.resident?(doc.id)
    assert_not YjsPersistence::LOCKS.key?(doc.id)
  end

  test "merge emits a merged event with byte sizes" do
    doc = Document.create!(title: "Metered")
    events = capture_notifications("merge.yjs") do
      assert_equal true, YjsPersistence.merge(doc, b64_update_for("measured content"))
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

    assert_notification("merge.yjs", outcome: "noop") { YjsPersistence.merge(doc, empty_update) }
  end

  test "a stale-generation rejection emits a rejected_stale event and still raises" do
    doc = Document.create!(title: "Stale", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("live"))
    stale_generation = doc.content_generation
    doc.replace_content!(source: "# Replacement")

    assert_notification("merge.yjs", outcome: "rejected_stale") do
      assert_raises(Document::StaleGenerationError) do
        YjsPersistence.merge(doc, b64_update_for("stale"), generation: stale_generation)
      end
    end
  end

  test "a locked rejection emits a rejected_locked event and still raises" do
    doc = Document.create!(title: "Locked", owner_token: "owner", owner_name: "O", link_access: "view")

    assert_notification("merge.yjs", outcome: "rejected_locked") do
      assert_raises(Document::EditingLockedError) do
        YjsPersistence.merge(doc, b64_update_for("forbidden"))
      end
    end
  end

  test "state_b64 emits a state event with the stored blob size" do
    doc = Document.create!(title: "Join")
    YjsPersistence.merge(doc, b64_update_for("content"))
    doc.reload

    assert_notification("state.yjs", outcome: "ok", blob_bytes: doc.yjs_state.bytesize) do
      YjsPersistence.state_b64(doc)
    end
  end

  test "a state_b64 failure is not classified as a success event" do
    doc = Document.create!(title: "Corrupt join")
    YjsPersistence.merge(doc, b64_update_for("content"))
    # Legacy row shape (no stored vector) forces the rebuild path, which is
    # where a corrupt blob can raise.
    doc.update_columns(yjs_state_vector: nil)

    original = YjsPersistence.singleton_class.instance_method(:load_ydoc)
    YjsPersistence.define_singleton_method(:load_ydoc) { |*| raise "corrupt blob" }
    begin
      events = capture_notifications("state.yjs") do
        assert_raises(RuntimeError) { YjsPersistence.state_b64(doc.reload) }
      end

      payload = events.first.payload
      assert_nil payload[:outcome], "outcome must stay unset so the subscriber logs the failure"
      assert payload[:exception].present?
    ensure
      YjsPersistence.singleton_class.define_method(:load_ydoc, original)
    end
  end

  test "a locked snapshot emits rejected_locked and still raises" do
    doc = Document.create!(title: "Locked", owner_token: "owner", owner_name: "O", link_access: "view")

    assert_notification("snapshot.yjs", outcome: "rejected_locked") do
      assert_raises(Document::EditingLockedError) do
        YjsPersistence.persist_snapshot(doc, state_vector_b64: nil, content: "nope", spans: [])
      end
    end
  end

  test "snapshot outcomes are taxonomized in events" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    stale_vector = Base64.strict_encode64(Y::Doc.new.state.pack("C*"))

    assert_notification("snapshot.yjs", outcome: "rejected_stale_vector") do
      YjsPersistence.persist_snapshot(doc, state_vector_b64: stale_vector, content: "stale", spans: [])
    end

    assert_notification("snapshot.yjs", outcome: "persisted") do
      YjsPersistence.persist_snapshot(doc, state_vector_b64: nil, content: "fresh", spans: [])
    end
  end

  test "an undecodable state vector emits invalid_state_vector, warns, and returns false" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    garbage_vector = Base64.strict_encode64([ 0x85, 0xff, 0xff ].pack("C*"))

    logged = capture_rails_log do
      event = assert_notification("snapshot.yjs", outcome: "invalid_state_vector") do
        persisted = YjsPersistence.persist_snapshot(
          doc, state_vector_b64: garbage_vector, content: "corrupt", spans: []
        )
        assert_not persisted
      end
      assert event.payload[:error].present?
    end

    # The log subscriber (config/initializers/yjs_instrumentation.rb) renders
    # non-success outcomes at warn — one structured line, no document content.
    assert_includes logged, "outcome=invalid_state_vector"
    assert_includes logged, "document_id=#{doc.id}"
    assert_not_includes logged, "corrupt"
    assert_equal "current", doc.reload.content_snapshot
  end

  private

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
