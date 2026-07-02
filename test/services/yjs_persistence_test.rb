require "test_helper"

class YjsPersistenceTest < ActiveSupport::TestCase
  def b64_update_for(text, from_doc: nil)
    ydoc = from_doc || Y::Doc.new
    ytext = ydoc.get_text("t")
    ytext << text
    Base64.strict_encode64(ydoc.diff.pack("C*"))
  end

  # Decodes the served handshake, which folds any unfolded tail first.
  def text_of(document)
    full_state, = YjsPersistence.state_b64(document.reload)
    ydoc = Y::Doc.new
    ydoc.sync(Base64.strict_decode64(full_state).unpack("C*"))
    ydoc.get_text("t").to_s
  end

  def doc_from(document)
    full_state, = YjsPersistence.state_b64(document.reload)
    ydoc = Y::Doc.new
    ydoc.sync(Base64.strict_decode64(full_state).unpack("C*"))
    ydoc
  end

  def fold_and_reload(document)
    YjsPersistence.fold!(document)
    document.reload
  end

  test "merge persists an update and survives reload" do
    doc = Document.create!(title: "Sync")
    YjsPersistence.merge(doc, b64_update_for("hello"))

    assert_equal "hello", text_of(doc)
    assert doc.reload.yjs_state.present?, "the read path folds the tail into the snapshot"
  end

  test "merge appends to the update log without loading the stored document" do
    doc = Document.create!(title: "Appended")

    # The hot path may probe the incoming update (O(update)) but must never
    # load the stored snapshot (O(document)).
    original = YjsPersistence.singleton_class.instance_method(:load_ydoc)
    YjsPersistence.define_singleton_method(:load_ydoc) { |*| raise "merge must not load the document" }
    begin
      YjsPersistence.merge(doc, b64_update_for("hello"))
    rescue RuntimeError => e
      flunk(e.message)
    ensure
      YjsPersistence.singleton_class.define_method(:load_ydoc, original)
    end

    doc.reload
    assert_nil doc.yjs_state, "the hot path must not write the snapshot"
    assert_equal 1, doc.yjs_document_updates.count
    assert_equal doc.content_generation, doc.yjs_document_updates.sole.content_generation
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
    assert_not doc.yjs_document_updates.exists?, "no-op merge must not bloat the log"
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
    assert_not doc.yjs_document_updates.exists?, "a rejected stale frame must not be appended"
  end

  test "merge accepts a frame whose generation matches the document's current one" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("current content"), generation: doc.content_generation)

    assert_equal "current content", text_of(doc)
  end

  test "merge trusts a frame with no generation (rollout compatibility)" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    doc.replace_content!(source: "# Replacement")

    YjsPersistence.merge(doc, b64_update_for("no generation sent"), generation: nil)

    assert_equal "no generation sent", text_of(doc),
                 "a frame with no generation key must still merge, matching pre-existing behavior"
  end

  test "corrupt base64 raises and leaves the document untouched" do
    doc = Document.create!(title: "Corrupt")
    YjsPersistence.merge(doc, b64_update_for("good content"))
    before = fold_and_reload(doc).yjs_state

    assert_raises(ArgumentError) { YjsPersistence.merge(doc, "not!!base64!!") }
    doc.reload
    assert_equal before, doc.yjs_state
    assert_not doc.yjs_document_updates.exists?
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

  # --- Folds ---------------------------------------------------------------

  test "a fold persists blob, state vector, and checksum, and clears the tail" do
    doc = Document.create!(title: "Folded")
    YjsPersistence.merge(doc, b64_update_for("content"))

    event = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc) }
    doc.reload

    assert doc.yjs_state.present?
    ydoc = Y::Doc.new
    ydoc.sync(doc.yjs_state.unpack("C*"))
    assert_equal "content", ydoc.get_text("t").to_s
    assert_equal ydoc.state, doc.yjs_state_vector.unpack("C*")
    assert_equal Digest::SHA256.hexdigest(doc.yjs_state), doc.yjs_state_checksum
    assert_not doc.yjs_document_updates.exists?, "integrated rows must be deleted"
    assert_equal 1, event.payload[:rows]
    assert_equal 1, event.payload[:integrated]
    assert_equal 0, event.payload[:retained]
  end

  test "folding matches the result of merging the old way" do
    doc = Document.create!(title: "Equivalent")
    client = Y::Doc.new
    YjsPersistence.merge(doc, b64_update_for("first ", from_doc: client))
    YjsPersistence.merge(doc, b64_update_for("second", from_doc: client))
    YjsPersistence.fold!(doc)

    reference = Y::Doc.new
    reference.sync(doc.reload.yjs_state.unpack("C*"))
    assert_equal "first second", reference.get_text("t").to_s
    assert_equal reference.state, doc.yjs_state_vector.unpack("C*")
  end

  test "a duplicate full-state row is deleted as self-contained" do
    doc = Document.create!(title: "Deduped")
    YjsPersistence.merge(doc, b64_update_for("content"))
    YjsPersistence.fold!(doc)

    # A synced client echoing the full state (e.g. a sync-reply that raced
    # the empty-update filter) appends a row that changes nothing.
    duplicate = Base64.strict_encode64(doc_from(doc).full_diff.pack("C*"))
    YjsPersistence.merge(doc, duplicate)
    assert doc.yjs_document_updates.exists?

    event = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc) }

    assert_equal 1, event.payload[:integrated], "a duplicate row is provably incorporated"
    assert_not doc.yjs_document_updates.exists?
  end

  test "a delete-only update folds, persists, and leaves no retained row" do
    doc = Document.create!(title: "Backspaced")
    client = Y::Doc.new
    YjsPersistence.merge(doc, b64_update_for("keep-me", from_doc: client))
    YjsPersistence.fold!(doc)

    # A backspace-only frame: zero structs, delete set only. It applies
    # deletes without advancing the state vector.
    before_delete = client.state
    client.get_text("t").slice!(4, 3) # delete "-me"
    delete_frame = client.diff(before_delete)
    YjsPersistence.merge(doc, Base64.strict_encode64(delete_frame.pack("C*")))

    event = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc) }

    assert_equal 1, event.payload[:integrated], "a pure delete-set frame is provably incorporated"
    assert_equal 0, event.payload[:retained]
    assert_not doc.reload.yjs_document_updates.exists?
    assert_equal "keep", text_of(doc), "the deletion must survive the fold and reload"
  end

  test "a joiner's delete-set echo on a document with deletion history is not retained" do
    doc = Document.create!(title: "Echoed")
    client = Y::Doc.new
    YjsPersistence.merge(doc, b64_update_for("abc", from_doc: client))
    before_delete = client.state
    client.get_text("t").slice!(2, 1)
    YjsPersistence.merge(doc, Base64.strict_encode64(client.diff(before_delete).pack("C*")))
    YjsPersistence.fold!(doc)

    # A fully-synced rejoining client's sync-reply is not [0,0] once the doc
    # has deletion history — it echoes the delete set.
    synced = doc_from(doc)
    echo = synced.diff(synced.state)
    assert_not_equal [ 0, 0 ], echo, "precondition: the echo must carry the delete set"
    YjsPersistence.merge(doc, Base64.strict_encode64(echo.pack("C*")))

    event = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc) }

    assert_equal 1, event.payload[:integrated], "a delete-set echo must not be retained forever"
    assert_not doc.reload.yjs_document_updates.exists?
    assert_equal "ab", text_of(doc)
  end

  test "an undecodable update is rejected before it becomes durable" do
    doc = Document.create!(title: "Garbage", seed_markdown: "# Template")
    garbage = Base64.strict_encode64("yrs-garbage-bytes")

    assert_notification("merge.yjs", outcome: "rejected_undecodable") do
      assert_raises(ArgumentError) { YjsPersistence.merge(doc, garbage) }
    end

    doc.reload
    assert_not doc.yjs_document_updates.exists?, "garbage must never be appended"
    assert_equal "pending", doc.seed_state, "garbage must not consume the seed claim"
  end

  test "a pending row is retained across folds and quarantined after the TTL" do
    doc = Document.create!(title: "Pending")
    # Build a causally dependent pair and append only the second half.
    client = Y::Doc.new
    text = client.get_text("t")
    text << "a"
    first_state = client.state
    text << "b"
    dependent = client.diff(first_state)
    YjsPersistence.merge(doc, Base64.strict_encode64(dependent.pack("C*")))

    event = assert_notification("fold.yjs") { YjsPersistence.fold!(doc) }
    assert_equal 1, event.payload[:retained], "a dependent row without its dependency stays pending"
    assert doc.yjs_document_updates.exists?, "pending rows are not deleted"

    travel YjsPersistence::ORPHAN_TTL + 1.minute do
      assert_notification("fold.yjs") { YjsPersistence.state_b64(doc.reload) }
    end

    assert_not doc.reload.yjs_document_updates.exists?, "orphans leave the log after the TTL"
    orphan = doc.yjs_state_archives.where(kind: "orphan").sole
    assert_equal dependent.pack("C*"), orphan.yjs_state, "orphaned bytes are preserved, not dropped"
  end

  test "rows from an older generation are deleted without folding" do
    doc = Document.create!(title: "Stale rows", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("old generation content"))
    # Simulate a straggler: bump the generation while the tail is unfolded,
    # without going through replace_content! (which deletes the tail).
    doc.reload.update_columns(content_generation: doc.content_generation + 1)

    event = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc.reload) }

    assert_equal 1, event.payload[:integrated]
    assert_not doc.reload.yjs_document_updates.exists?
    assert_nil doc.yjs_state, "an older generation's rows must not materialize"
  end

  test "a fold that cannot produce a loadable blob degrades without persisting" do
    doc = Document.create!(title: "Degraded")
    YjsPersistence.merge(doc, b64_update_for("still served"))

    original = YjsPersistence.singleton_class.instance_method(:blob_loadable?)
    YjsPersistence.define_singleton_method(:blob_loadable?) { |*| false }
    begin
      full_state = nil
      assert_notification("fold.yjs", outcome: "invalid_encode") do
        full_state, = YjsPersistence.state_b64(doc.reload)
      end

      client = Y::Doc.new
      client.sync(Base64.strict_decode64(full_state).unpack("C*"))
      assert_equal "still served", client.get_text("t").to_s, "clients are served from the in-memory doc"
      doc.reload
      assert_nil doc.yjs_state, "an unloadable blob must never be persisted"
      assert doc.yjs_document_updates.exists?, "rows stay for the next fold attempt"
    ensure
      YjsPersistence.singleton_class.define_method(:blob_loadable?, original)
    end
  end

  test "the merge threshold triggers an inline fold" do
    doc = Document.create!(title: "Threshold")
    client = Y::Doc.new

    (YjsPersistence::FOLD_THRESHOLD - 1).times do |i|
      YjsPersistence.merge(doc, b64_update_for("chunk#{i};", from_doc: client))
    end
    assert_nil doc.reload.yjs_state, "below the threshold nothing materializes"

    assert_notification("fold.yjs", outcome: "folded") do
      YjsPersistence.merge(doc, b64_update_for("final", from_doc: client))
    end

    doc.reload
    assert doc.yjs_state.present?
    assert_not doc.yjs_document_updates.exists?
  end

  # --- Healing (durability layer) ------------------------------------------

  test "a corrupt blob heals from the latest same-generation checkpoint at fold time" do
    doc = Document.create!(title: "Healable")
    YjsPersistence.merge(doc, b64_update_for("first. "))
    YjsPersistence.fold!(doc)
    # The second fold checkpoints the pre-fold state ("first. ").
    YjsPersistence.merge(doc, b64_update_for("second. ", from_doc: doc_from(doc)))
    YjsPersistence.fold!(doc)
    assert_equal 1, doc.yjs_state_archives.where(kind: "checkpoint").count

    doc.reload.update_columns(yjs_state: "garbage-bytes")
    YjsPersistence.merge(doc.reload, b64_update_for("third."))

    event = assert_notification("recovered.yjs", outcome: "recovered", restored_from: "checkpoint") do
      YjsPersistence.fold!(doc.reload)
    end
    assert_equal doc.id, event.payload[:document_id]

    merged = text_of(doc.reload)
    assert_includes merged, "first", "checkpoint content must be restored"
    assert_includes merged, "third", "the appended update must still apply"
    assert_not_includes merged, "second", "edits after the checkpoint are the bounded loss"

    quarantine = doc.yjs_state_archives.where(kind: "quarantine").sole
    assert_equal "garbage-bytes", quarantine.yjs_state
    assert quarantine.error.present?
  end

  test "a valid blob written by pre-checksum code is re-stamped, not destroyed" do
    doc = Document.create!(title: "Mixed version")
    YjsPersistence.merge(doc, b64_update_for("current content. "))
    YjsPersistence.fold!(doc)

    # Simulate an old-code merge during a deploy window: the blob and vector
    # advance but the checksum column is not written, leaving it stale.
    ydoc = doc_from(doc)
    ydoc.get_text("t") << "old-code edit. "
    doc.reload.update_columns(
      yjs_state: ydoc.full_diff.pack("C*"),
      yjs_state_vector: ydoc.state.pack("C*")
    )
    YjsPersistence.merge(doc.reload, b64_update_for("new-code edit."))

    assert_notification("recovered.yjs", restored_from: "restamped") do
      YjsPersistence.fold!(doc.reload)
    end

    merged = text_of(doc.reload)
    assert_includes merged, "current content", "healthy state must survive a stale checksum"
    assert_includes merged, "old-code edit", "the pre-checksum write must survive"
    assert_includes merged, "new-code edit"
    assert_not doc.yjs_state_archives.where(kind: "quarantine").exists?,
               "a stale checksum on a loadable blob is not corruption"
    assert_equal Digest::SHA256.hexdigest(doc.yjs_state), doc.yjs_state_checksum
  end

  test "a corrupt legacy row without a checksum heals at fold time" do
    doc = Document.create!(title: "Legacy corrupt")
    YjsPersistence.merge(doc, b64_update_for("pre-migration content"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state: "garbage-bytes", yjs_state_checksum: nil)
    YjsPersistence.merge(doc.reload, b64_update_for("recovered"))

    assert_notification("recovered.yjs", restored_from: "empty") do
      YjsPersistence.fold!(doc.reload)
    end

    assert_equal "recovered", text_of(doc.reload)
  end

  test "a corrupt legacy row without a checksum heals on the join path" do
    doc = Document.create!(title: "Legacy corrupt join")
    YjsPersistence.merge(doc, b64_update_for("pre-migration content"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state: "garbage-bytes", yjs_state_checksum: nil)

    full_state, state_vector = nil
    assert_notification("recovered.yjs", restored_from: "empty") do
      full_state, state_vector = YjsPersistence.state_b64(doc.reload)
    end

    assert full_state.present?
    assert state_vector.present?
  end

  test "the snapshot gate heals a corrupt legacy row instead of raising" do
    doc = Document.create!(title: "Legacy snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(
      yjs_state: "garbage-bytes", yjs_state_checksum: nil, yjs_state_vector: nil
    )

    persisted = nil
    assert_notification("recovered.yjs", restored_from: "empty") do
      persisted = YjsPersistence.persist_snapshot(
        doc.reload,
        state_vector_b64: Base64.strict_encode64(Y::Doc.new.state.pack("C*")),
        content: "fresh", spans: []
      )
    end

    assert persisted
    assert_equal "fresh", doc.reload.content_snapshot
  end

  test "a corrupt blob with no checkpoint heals to empty" do
    doc = Document.create!(title: "Empty heal")
    YjsPersistence.merge(doc, b64_update_for("only content"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state: "garbage-bytes")
    YjsPersistence.merge(doc.reload, b64_update_for("fresh start"))

    assert_notification("recovered.yjs", restored_from: "empty") do
      YjsPersistence.fold!(doc.reload)
    end

    assert_equal "fresh start", text_of(doc.reload)
    assert doc.yjs_state_archives.where(kind: "quarantine").exists?
  end

  test "healing never restores a replacement archive from a previous generation" do
    doc = Document.create!(title: "No resurrection", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("pre-replacement secret. "))
    doc.replace_content!(source: "# Replacement")
    assert doc.yjs_state_archives.where(kind: "replacement").exists?

    YjsPersistence.merge(doc.reload, b64_update_for("new generation content"))
    YjsPersistence.fold!(doc.reload)
    doc.reload.update_columns(yjs_state: "garbage-bytes")
    YjsPersistence.merge(doc.reload, b64_update_for("after heal"))

    assert_notification("recovered.yjs", restored_from: "empty") do
      YjsPersistence.fold!(doc.reload)
    end

    merged = text_of(doc.reload)
    assert_not_includes merged, "pre-replacement secret",
                        "a heal must never resurrect content a replacement wiped"
  end

  test "a corrupt blob on the join path heals instead of bricking" do
    doc = Document.create!(title: "Join heal")
    YjsPersistence.merge(doc, b64_update_for("served content"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state: "garbage-bytes")

    full_state, state_vector = nil
    assert_notification("recovered.yjs", restored_from: "empty") do
      full_state, state_vector = YjsPersistence.state_b64(doc.reload)
    end

    assert full_state.present?
    assert state_vector.present?
    assert doc.reload.yjs_state_archives.where(kind: "quarantine").exists?
  end

  test "a corrupt blob does not raise out of the snapshot gate" do
    doc = Document.create!(title: "Snapshot heal", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state: "garbage-bytes", yjs_state_vector: "also-garbage")

    persisted = YjsPersistence.persist_snapshot(
      doc.reload,
      state_vector_b64: Base64.strict_encode64(Y::Doc.new.state.pack("C*")),
      content: "fresh", spans: []
    )

    assert persisted, "after healing to empty, a fresh client snapshot is acceptable"
    assert_equal "fresh", doc.reload.content_snapshot
  end

  test "a legacy row without a checksum loads without verification" do
    doc = Document.create!(title: "Legacy checksum")
    YjsPersistence.merge(doc, b64_update_for("old row"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state_checksum: nil, yjs_state_vector: nil)

    full_state, = YjsPersistence.state_b64(doc.reload)

    client = Y::Doc.new
    client.sync(Base64.strict_decode64(full_state).unpack("C*"))
    assert_equal "old row", client.get_text("t").to_s
  end

  # --- Checkpoints and archives ---------------------------------------------

  test "checkpoints are interval-gated" do
    doc = Document.create!(title: "Checkpointed")
    YjsPersistence.merge(doc, b64_update_for("one. "))
    YjsPersistence.fold!(doc)
    YjsPersistence.merge(doc, b64_update_for("two. ", from_doc: doc_from(doc)))
    YjsPersistence.fold!(doc)
    YjsPersistence.merge(doc, b64_update_for("three. ", from_doc: doc_from(doc)))
    YjsPersistence.fold!(doc)
    assert_equal 1, doc.yjs_state_archives.where(kind: "checkpoint").count,
                 "checkpoints within the interval must not accumulate"

    travel YjsPersistence::CHECKPOINT_INTERVAL + 1.minute do
      YjsPersistence.merge(doc, b64_update_for("four.", from_doc: doc_from(doc)))
      YjsPersistence.fold!(doc)
    end
    assert_equal 2, doc.yjs_state_archives.where(kind: "checkpoint").count
  end

  test "archive pruning keeps the newest entries per kind" do
    doc = Document.create!(title: "Pruned")
    YjsPersistence.merge(doc, b64_update_for("content"))
    fold_and_reload(doc)

    created = 8.times.map { YjsStateArchive.record!(doc, kind: "checkpoint") }
    survivors = doc.yjs_state_archives.where(kind: "checkpoint").order(:id).ids
    assert_equal created.last(YjsStateArchive::MAX_PER_KIND).map(&:id), survivors,
                 "the newest archives must survive pruning"

    YjsStateArchive.record!(doc, kind: "quarantine", error: "x")
    assert_equal 1, doc.yjs_state_archives.where(kind: "quarantine").count,
                 "pruning one kind must not touch another"
  end

  test "a new generation gets its own checkpoint despite a recent old-generation one" do
    doc = Document.create!(title: "Regenerated", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("gen zero. "))
    YjsPersistence.fold!(doc)
    YjsPersistence.merge(doc, b64_update_for("more gen zero. ", from_doc: doc_from(doc)))
    YjsPersistence.fold!(doc)
    assert doc.yjs_state_archives.where(kind: "checkpoint", content_generation: 0).exists?

    doc.replace_content!(source: "# Replacement")
    YjsPersistence.merge(doc.reload, b64_update_for("gen one. "))
    YjsPersistence.fold!(doc)
    YjsPersistence.merge(doc, b64_update_for("more gen one.", from_doc: doc_from(doc)))
    YjsPersistence.fold!(doc)

    assert doc.yjs_state_archives.where(kind: "checkpoint", content_generation: 1).exists?,
           "the interval gate must not let an old generation's checkpoint block the new one"
  end

  # --- Handshake serving ----------------------------------------------------

  test "state_b64 serves the handshake from columns without building a doc" do
    doc = Document.create!(title: "Fast join")
    YjsPersistence.merge(doc, b64_update_for("column served"))
    fold_and_reload(doc)

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

  test "state_b64 folds and serves when the tail is non-empty" do
    doc = Document.create!(title: "Tail join")
    YjsPersistence.merge(doc, b64_update_for("unfolded content"))

    full_state = nil
    assert_notification("state.yjs", served_from: "fold") do
      full_state, = YjsPersistence.state_b64(doc.reload)
    end

    client = Y::Doc.new
    client.sync(Base64.strict_decode64(full_state).unpack("C*"))
    assert_equal "unfolded content", client.get_text("t").to_s
    assert doc.reload.yjs_state.present?, "the join folds the tail"
  end

  test "a legacy row without a stored vector falls back to rebuilding" do
    doc = Document.create!(title: "Legacy")
    YjsPersistence.merge(doc, b64_update_for("old row"))
    fold_and_reload(doc)
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

  test "replace_content! clears the stored state vector until the next fold" do
    doc = Document.create!(title: "Reset", seed_content: "# Seed")
    YjsPersistence.merge(doc, b64_update_for("live"))
    fold_and_reload(doc)
    assert doc.yjs_state_vector.present?

    doc.replace_content!(source: "# Replacement")
    assert_nil doc.reload.yjs_state_vector

    YjsPersistence.merge(doc, b64_update_for("fresh"))
    fold_and_reload(doc)
    assert doc.yjs_state_vector.present?
  end

  # --- Snapshot gate ----------------------------------------------------------

  test "the snapshot staleness gate reads the stored vector without building a doc" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    fold_and_reload(doc)
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

  test "the snapshot gate folds an unfolded tail before comparing" do
    doc = Document.create!(title: "Tail gate", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("snapshot base"))
    YjsPersistence.fold!(doc)
    snapshot_only_vector = Base64.strict_encode64(doc_from(doc).state.pack("C*"))

    # New content lands in the tail after the client last synced.
    YjsPersistence.merge(doc, b64_update_for("tail content"))

    persisted = YjsPersistence.persist_snapshot(
      doc.reload, state_vector_b64: snapshot_only_vector, content: "stale", spans: []
    )

    assert_not persisted, "a client that has not seen the tail is stale"
    assert_equal "current", doc.reload.content_snapshot
  end

  test "a corrupt stored vector falls back to the blob for the snapshot gate" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    client = Y::Doc.new
    YjsPersistence.merge(doc, b64_update_for("server content", from_doc: client))
    fold_and_reload(doc)
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
    fold_and_reload(doc)
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
    fold_and_reload(doc)

    server = Y::Doc.new
    server.sync(doc.yjs_state.unpack("C*"))
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

  # --- Instrumentation --------------------------------------------------------

  test "merge emits an appended event" do
    doc = Document.create!(title: "Metered")
    events = capture_notifications("merge.yjs") do
      assert_equal true, YjsPersistence.merge(doc, b64_update_for("measured content"))
    end

    assert_equal 1, events.length
    payload = events.first.payload
    assert_equal doc.id, payload[:document_id]
    assert_equal "appended", payload[:outcome]
    assert_operator payload[:update_bytes], :>, 0
    assert_equal 1, payload[:tail_rows]
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
    fold_and_reload(doc)

    assert_notification("state.yjs", outcome: "ok", blob_bytes: doc.yjs_state.bytesize) do
      YjsPersistence.state_b64(doc)
    end
  end

  test "a state_b64 failure is not classified as a success event" do
    doc = Document.create!(title: "Corrupt join")
    YjsPersistence.merge(doc, b64_update_for("content"))

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
