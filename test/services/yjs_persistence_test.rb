require "test_helper"
require "open3"

class YjsPersistenceTest < ActiveSupport::TestCase
  def b64_update_for(text, from_doc: nil)
    ydoc = from_doc || Y::Doc.new
    ytext = ydoc.get_text("t")
    ytext << text
    Base64.strict_encode64(ydoc.encode_state_as_update)
  end

  # Decodes the served handshake, which folds any unfolded tail first.
  def text_of(document)
    full_state, = YjsPersistence.state_b64(document.reload)
    ydoc = Y::Doc.new
    ydoc.apply_update(Base64.strict_decode64(full_state))
    ydoc.get_text("t").to_s
  end

  def doc_from(document)
    full_state, = YjsPersistence.state_b64(document.reload)
    ydoc = Y::Doc.new
    ydoc.apply_update(Base64.strict_decode64(full_state))
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

  # Two independent claimants: A's claim expires before A writes, B takes over.
  def expired_then_reclaimed(doc)
    first = Document.find(doc.id)
    assert first.try_claim_seed
    second = nil
    travel(Document::SEED_CLAIM_TIMEOUT + 1.second) do
      second = Document.find(doc.id)
      assert second.try_claim_seed
    end
    [ first.seed_claim_token, second.seed_claim_token ]
  end

  test "a slow claimant's seed is refused after the next claimant wrote, leaving one copy" do
    doc = Document.create!(title: "Slow claimant", seed_markdown: "body")
    claim_a, claim_b = expired_then_reclaimed(doc)

    YjsPersistence.merge(doc, b64_update_for("body"), seed_claim: claim_b)
    assert_raises(Document::StaleSeedClaimError) do
      YjsPersistence.merge(doc, b64_update_for("body"), seed_claim: claim_a)
    end

    assert_equal "body", text_of(doc)
  end

  test "a superseded claimant's first write is accepted while nothing is stored, and the newer claimant's is refused" do
    doc = Document.create!(title: "Slow claimant", seed_markdown: "body")
    claim_a, claim_b = expired_then_reclaimed(doc)
    author = Y::Doc.new

    YjsPersistence.merge(doc, b64_update_for("body", from_doc: author), seed_claim: claim_a)
    assert_equal "seeded", doc.reload.seed_state
    assert_raises(Document::StaleSeedClaimError) do
      YjsPersistence.merge(doc, b64_update_for("body"), seed_claim: claim_b)
    end
    assert_equal "body", text_of(doc)

    YjsPersistence.merge(doc, b64_update_for(" edited", from_doc: author), seed_claim: claim_a)
    assert_equal "body edited", text_of(doc)
    assert_not Document.find(doc.id).try_claim_seed
  end

  test "a current claim is refused when someone else's content is already stored" do
    doc = Document.create!(title: "Occupied", seed_markdown: "body")
    assert doc.try_claim_seed
    claim = doc.seed_claim_token
    YjsPersistence.merge(doc, b64_update_for("body"))

    assert_raises(Document::StaleSeedClaimError) do
      YjsPersistence.merge(doc, b64_update_for("body"), seed_claim: claim)
    end
    assert_equal "body", text_of(doc)
  end

  test "a claimant repeating its own seed, with later edits, is accepted" do
    doc = Document.create!(title: "Repeated", seed_markdown: "body")
    assert doc.try_claim_seed
    claim = doc.seed_claim_token
    author = Y::Doc.new

    YjsPersistence.merge(doc, b64_update_for("body", from_doc: author), seed_claim: claim)
    YjsPersistence.merge(doc, b64_update_for(" edited", from_doc: author), seed_claim: claim)

    assert_equal "body edited", text_of(doc)
  end

  test "a malformed seed claim is refused rather than treated as absent" do
    doc = Document.create!(title: "Malformed", seed_markdown: "body")
    assert doc.try_claim_seed

    [ "", "nope", 7, {} ].each do |claim|
      assert_raises(Document::StaleSeedClaimError) do
        YjsPersistence.merge(doc, b64_update_for("body"), seed_claim: claim)
      end
    end
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
    empty_update = Base64.strict_encode64(Y::Doc.new.compacted_state_update)
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

  test "merge rejects a frame with missing or malformed generation" do
    doc = Document.create!(title: "Live", seed_content: "# Seed")
    doc.replace_content!(source: "# Replacement")

    [ nil, "1", "bogus" ].each do |bad_generation|
      assert_notification("merge.yjs", outcome: "rejected_stale") do
        assert_raises(Document::StaleGenerationError) do
          YjsPersistence.merge(doc, b64_update_for("no generation sent"), generation: bad_generation)
        end
      end
    end

    assert_nil doc.reload.yjs_state
    assert_not doc.yjs_document_updates.exists?,
               "missing or non-integer generation must never bypass the anti-resurrection guard"
  end

  test "merge_bytes persists raw binary updates without decoding base64" do
    doc = Document.create!(title: "RawBytes")
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "binary update"
    raw = ydoc.encode_state_as_update

    decode_calls = 0
    original_decode = Base64.method(:strict_decode64)
    Base64.define_singleton_method(:strict_decode64) do |*args|
      decode_calls += 1
      original_decode.call(*args)
    end
    begin
      assert_equal true, YjsPersistence.merge_bytes(doc, raw, generation: doc.content_generation)
    ensure
      Base64.define_singleton_method(:strict_decode64, original_decode)
    end

    assert_equal 0, decode_calls, "merge_bytes must accept raw bytes directly without base64 decoding"
    assert_equal "binary update", text_of(doc)
  end

  test "merge_bytes probes decodable_update? outside mutex and row locks" do
    doc = Document.create!(title: "NoLockProbe", seed_markdown: "# Template")

    # Holding the document's persistence mutex on the current thread guarantees
    # a ThreadError deadlock if merge_bytes attempts to acquire lock_for before
    # rejecting the undecodable payload.
    YjsPersistence.send(:lock_for, doc.id).synchronize do
      assert_notification("merge.yjs", outcome: "rejected_undecodable") do
        assert_raises(ArgumentError) do
          YjsPersistence.merge_bytes(doc, "yrs-garbage-bytes", generation: doc.content_generation)
        end
      end
    end

    assert_not doc.reload.yjs_document_updates.exists?
    assert_equal "pending", doc.seed_state
  end

  test "merge_bytes rejects read-only callers before probing decodable_update?" do
    doc = Document.create!(title: "LockedGarbage", owner_token: "owner", owner_name: "O", link_access: "view")

    YjsPersistence.send(:lock_for, doc.id).synchronize do
      assert_notification("merge.yjs", outcome: "rejected_locked") do
        assert_raises(Document::EditingLockedError) do
          YjsPersistence.merge_bytes(doc, "yrs-garbage-bytes", generation: doc.content_generation)
        end
      end
    end
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
    client.apply_update(Base64.strict_decode64(full_state))
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
    ydoc.apply_update(doc.yjs_state)
    assert_equal "content", ydoc.get_text("t").to_s
    assert_equal ydoc.encode_state_vector, doc.yjs_state_vector
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
    reference.apply_update(doc.reload.yjs_state)
    assert_equal "first second", reference.get_text("t").to_s
    assert_equal reference.encode_state_vector, doc.yjs_state_vector
  end

  test "a duplicate full-state row is deleted as self-contained" do
    doc = Document.create!(title: "Deduped")
    YjsPersistence.merge(doc, b64_update_for("content"))
    YjsPersistence.fold!(doc)

    # A synced client echoing the full state (e.g. a sync-reply that raced
    # the empty-update filter) appends a row that changes nothing.
    duplicate = Base64.strict_encode64(doc_from(doc).compacted_state_update)
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
    before_delete = client.encode_state_vector
    client.get_text("t").delete(4, 3) # delete "-me"
    delete_frame = client.encode_state_as_update(before_delete)
    YjsPersistence.merge(doc, Base64.strict_encode64(delete_frame))

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
    before_delete = client.encode_state_vector
    client.get_text("t").delete(2, 1)
    YjsPersistence.merge(doc, Base64.strict_encode64(client.encode_state_as_update(before_delete)))
    YjsPersistence.fold!(doc)

    # A fully-synced rejoining client's sync-reply is not [0,0] once the doc
    # has deletion history — it echoes the delete set.
    synced = doc_from(doc)
    echo = synced.encode_state_as_update(synced.encode_state_vector)
    assert_not_equal YjsPersistence::EMPTY_UPDATE, echo, "precondition: the echo must carry the delete set"
    YjsPersistence.merge(doc, Base64.strict_encode64(echo))

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

  test "a base64-valid update with corrupted tail bytes raises ArgumentError cleanly" do
    doc = Document.create!(title: "CorruptTail", seed_markdown: "# Template")
    valid = Base64.strict_decode64(b64_update_for("hello world"))
    # Mutate the final bytes inside the encoded update (truncates/corrupts the
    # varint/delete-set tail that previously triggered native crashes).
    corrupted = valid.byteslice(0, valid.bytesize - 2) + "\xff\xff".b

    assert_notification("merge.yjs", outcome: "rejected_undecodable") do
      assert_raises(ArgumentError) { YjsPersistence.merge(doc, Base64.strict_encode64(corrupted)) }
    end

    doc.reload
    assert_not doc.yjs_document_updates.exists?
    assert_equal "pending", doc.seed_state
  end

  test "a stored blob with corrupted tail bytes heals cleanly via CorruptStateError" do
    doc = Document.create!(title: "StoredCorruptTail")
    YjsPersistence.merge(doc, b64_update_for("good state"))
    YjsPersistence.fold!(doc)

    valid = doc.reload.yjs_state
    corrupted = valid.byteslice(0, valid.bytesize - 2) + "\xff\xff".b
    doc.update_columns(
      yjs_state: corrupted,
      yjs_state_checksum: Digest::SHA256.hexdigest(corrupted)
    )
    YjsPersistence.merge(doc.reload, b64_update_for("recovered"))

    assert_notification("recovered.yjs", restored_from: "empty") do
      YjsPersistence.fold!(doc.reload)
    end
    assert_equal "recovered", text_of(doc.reload)
    assert_equal corrupted, doc.yjs_state_archives.where(kind: YjsStateArchive::QUARANTINE).sole.yjs_state
  end

  test "an out-of-order delete-only frame is retained until its target insert arrives" do
    doc = Document.create!(title: "OutOfOrderDelete")
    client = Y::Doc.new(300)
    client.get_text("t") << "keep-me"
    insert_update = client.encode_state_as_update
    sv_after_insert = client.encode_state_vector
    client.get_text("t").delete(4, 3)
    delete_update = client.encode_state_as_update(sv_after_insert)

    YjsPersistence.merge(doc, Base64.strict_encode64(delete_update))
    first_fold = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc) }
    assert_equal 1, first_fold.payload[:retained], "an out-of-order delete must stay retained until its target arrives"
    assert_equal 1, doc.reload.yjs_document_updates.count

    YjsPersistence.merge(doc, Base64.strict_encode64(insert_update))
    second_fold = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc) }
    assert_equal 0, second_fold.payload[:retained]
    assert_not doc.reload.yjs_document_updates.exists?
    assert_equal "keep", text_of(doc)
  end

  test "a split edit is stored whole or not at all" do
    doc = Document.create!(title: "Split edit")
    client = Y::Doc.new
    text = client.get_text("t")
    text << "first "
    first = client.encode_state_as_update
    vector = client.encode_state_vector
    text << "second"
    second = client.encode_state_as_update(vector)

    assert_raises(ArgumentError) do
      YjsPersistence.merge_updates(doc, [ first, "garbage" ], generation: doc.content_generation)
    end
    assert_not doc.reload.yjs_document_updates.exists?

    # One fold, with every piece in: none may run between them.
    (YjsPersistence::FOLD_THRESHOLD - 1).times { |i| YjsPersistence.merge(doc, b64_update_for("row #{i} ")) }
    fold = assert_notification("fold.yjs") do
      YjsPersistence.merge_updates(doc.reload, [ first, second ], generation: doc.content_generation)
    end
    assert_equal YjsPersistence::FOLD_THRESHOLD + 1, fold.payload[:rows]
    assert_equal 0, fold.payload[:retained]
    assert_includes text_of(doc), "first second"
  end

  test "what the page's splitter makes of an edit is stored as that edit" do
    script = <<~JS
      import * as Y from 'yjs'
      import { splitUpdate } from './app/frontend/editor/split_update.ts'
      const b64 = (bytes) => Buffer.from(bytes).toString('base64')
      const peer = new Y.Doc()
      peer.getText('t').insert(0, 'kept by the peer, replaced by the writer')
      const writer = new Y.Doc()
      Y.applyUpdate(writer, Y.encodeStateAsUpdate(peer))
      const edits = []
      writer.on('update', (update) => edits.push(update))
      const text = writer.getText('t')
      writer.transact(() => {
        text.delete(18, 22)
        text.insert(18, 'long text cut in the middle 漢😀 '.repeat(60))
        for (let i = 0; i < 20; i += 1) text.insert(40, `run ${i} `, { bold: true })
        text.format(0, 12, { italic: true })
        text.delete(100, 50)
        text.insert(text.length, 'end')
        text.delete(text.length - 2, 1)
      })
      const pieces = splitUpdate(edits[0], 700)
      console.log(JSON.stringify({
        base: b64(Y.encodeStateAsUpdate(peer)), pieces: pieces.map(b64), text: text.toString()
      }))
    JS
    output, errors, status = Open3.capture3(
      "node", "--input-type=module", "-e", script, chdir: Rails.root.to_s
    )
    assert status.success?, errors
    edit = JSON.parse(output)
    assert_operator edit["pieces"].size, :>, 2

    doc = Document.create!(title: "Split by the page")
    YjsPersistence.merge(doc, edit["base"])
    YjsPersistence.merge_updates(
      doc.reload, edit["pieces"].map { |piece| Base64.strict_decode64(piece) },
      generation: doc.content_generation
    )
    assert_not doc.reload.yjs_document_updates.exists?
    assert_not doc_from(doc).pending?
    assert_equal edit["text"], text_of(doc)
  end

  test "a split edit sent again leaves no rows and no second copy" do
    doc = Document.create!(title: "Split repeat")
    client = Y::Doc.new
    text = client.get_text("t")
    text << "first "
    first = client.encode_state_as_update
    vector = client.encode_state_vector
    text << "second"
    second = client.encode_state_as_update(vector)

    3.times do
      YjsPersistence.merge_updates(doc.reload, [ first, second ], generation: doc.content_generation)
      assert_not doc.reload.yjs_document_updates.exists?
    end
    assert_equal "first second", text_of(doc)
  end

  test "a failure while storing a split edit stores none of it" do
    doc = Document.create!(title: "Split rollback")
    updates = [ b64_update_for("one"), b64_update_for("two") ].map { |update| Base64.strict_decode64(update) }
    original = YjsPersistence.method(:perform_fold)
    YjsPersistence.define_singleton_method(:perform_fold) { |_document| raise "fold failed" }
    begin
      assert_raises(RuntimeError) do
        YjsPersistence.merge_updates(doc, updates, generation: doc.content_generation)
      end
    ensure
      YjsPersistence.define_singleton_method(:perform_fold, original)
    end
    assert_not doc.reload.yjs_document_updates.exists?
    assert_equal "pending", doc.seed_state
  end

  test "a split seed is stored under its claim, and refused once another seed is" do
    doc = Document.create!(title: "Split seed", seed_content: "# Seed")
    assert doc.try_claim_seed
    claim = doc.seed_claim_token
    pieces = lambda do |content|
      client = Y::Doc.new
      text = client.get_text("t")
      text << content
      first = client.encode_state_as_update
      vector = client.encode_state_vector
      text << " end"
      [ first, client.encode_state_as_update(vector) ]
    end
    own = pieces.call("seed")
    2.times do
      YjsPersistence.merge_updates(doc.reload, own, generation: doc.content_generation, seed_claim: claim)
    end
    assert_equal "seeded", doc.reload.seed_state
    assert_raises(Document::StaleSeedClaimError) do
      YjsPersistence.merge_updates(
        doc, pieces.call("other"), generation: doc.content_generation, seed_claim: claim
      )
    end
    assert_equal "seed end", text_of(doc)
  end

  test "a pending row is retained across folds and quarantined after the TTL" do
    doc = Document.create!(title: "Pending")
    # Build a causally dependent pair and append only the second half.
    client = Y::Doc.new
    text = client.get_text("t")
    text << "a"
    first_state = client.encode_state_vector
    text << "b"
    dependent = client.encode_state_as_update(first_state)
    YjsPersistence.merge(doc, Base64.strict_encode64(dependent))

    event = assert_notification("fold.yjs") { YjsPersistence.fold!(doc) }
    assert_equal 1, event.payload[:retained], "a dependent row without its dependency stays pending"
    assert doc.yjs_document_updates.exists?, "pending rows are not deleted"

    travel YjsPersistence::ORPHAN_TTL + 1.minute do
      assert_notification("fold.yjs") { YjsPersistence.state_b64(doc.reload) }
    end

    assert_not doc.reload.yjs_document_updates.exists?, "orphans leave the log after the TTL"
    orphan = doc.yjs_state_archives.where(kind: "orphan").sole
    assert_equal dependent, orphan.yjs_state, "orphaned bytes are preserved, not dropped"
  end

  test "a mixed frame with integrated and pending structs retains its pending half until its dependency arrives" do
    doc = Document.create!(title: "MixedPending")

    client_a = Y::Doc.new(100)
    client_a.get_text("t") << "fromA;"
    update_a = client_a.encode_state_as_update

    client_b = Y::Doc.new(200)
    client_b.get_text("t") << "b0:"
    sv_b0 = client_b.encode_state_vector
    update_b0 = client_b.encode_state_as_update
    client_b.get_text("t") << "b1;"
    update_b1 = client_b.encode_state_as_update(sv_b0)

    mixed_doc = Y::Doc.new
    mixed_doc.apply_update(update_a)
    mixed_doc.apply_update(update_b1)
    mixed = mixed_doc.encode_state_as_update

    YjsPersistence.merge(doc, Base64.strict_encode64(mixed))

    first_fold = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc) }
    assert_equal 1, first_fold.payload[:retained], "mixed frame must stay retained until its pending half integrates"
    assert_equal 1, doc.reload.yjs_document_updates.count
    assert_equal "fromA;", text_of(doc)

    YjsPersistence.merge(doc, Base64.strict_encode64(update_b0))
    second_fold = assert_notification("fold.yjs", outcome: "folded") { YjsPersistence.fold!(doc) }
    assert_equal 0, second_fold.payload[:retained]
    assert_not doc.reload.yjs_document_updates.exists?

    merged = text_of(doc)
    assert_includes merged, "fromA;"
    assert_includes merged, "b0:b1;"
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
      client.apply_update(Base64.strict_decode64(full_state))
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

  test "retained pending rows do not trigger a fold storm on subsequent merges" do
    doc = Document.create!(title: "NoFoldStorm")
    pending_client = Y::Doc.new(500)
    pending_client.get_text("t") << "missing-root"
    root_sv = pending_client.encode_state_vector

    # Append FOLD_THRESHOLD causally-pending updates (all missing root_sv).
    # The 64th append triggers one fold that retains and stamps retained_at
    # on all 64 rows.
    fold_events = capture_notifications("fold.yjs") do
      YjsPersistence::FOLD_THRESHOLD.times do |i|
        pending_client.get_text("t") << "p#{i};"
        dep = pending_client.encode_state_as_update(root_sv)
        root_sv = pending_client.encode_state_vector
        YjsPersistence.merge(doc, Base64.strict_encode64(dep))
      end
    end

    assert_equal 1, fold_events.length
    assert_equal YjsPersistence::FOLD_THRESHOLD, doc.yjs_document_updates.count
    assert_equal 0, doc.yjs_document_updates.unexamined.count
    assert doc.yjs_document_updates.all? { |row| row.retained_at.present? }

    # Subsequent keystrokes must stay on the O(update) append path until
    # another FOLD_THRESHOLD *new* unexamined rows accumulate.
    writer = Y::Doc.new(600)
    storm_events = capture_notifications("fold.yjs") do
      (YjsPersistence::FOLD_THRESHOLD - 1).times do |i|
        YjsPersistence.merge(doc, b64_update_for("w#{i};", from_doc: writer))
      end
    end
    assert_empty storm_events, "lingering retained rows must not trigger folds on every merge"
    assert_equal YjsPersistence::FOLD_THRESHOLD - 1, doc.yjs_document_updates.unexamined.count

    # The 64th new unexamined row triggers exactly one inline fold,
    # integrating the 64 valid rows while keeping the 64 retained rows stamped.
    assert_notification("fold.yjs", outcome: "folded", integrated: YjsPersistence::FOLD_THRESHOLD, retained: YjsPersistence::FOLD_THRESHOLD) do
      YjsPersistence.merge(doc, b64_update_for("trigger", from_doc: writer))
    end
    assert_equal 0, doc.yjs_document_updates.unexamined.count
    assert_equal YjsPersistence::FOLD_THRESHOLD, doc.yjs_document_updates.count
  end

  test "an undecodable poison-pill row in the log is quarantined and deleted immediately" do
    doc = Document.create!(title: "PoisonPill")
    YjsPersistence.merge(doc, b64_update_for("healthy"))
    YjsPersistence.fold!(doc)
    before_state = doc.reload.yjs_state

    # Simulate a permanently malformed row already in the WAL (e.g. legacy row
    # or corruption bypassing ingress validation).
    bad_bytes = "definitely-not-a-yjs-update".b
    doc.yjs_document_updates.create!(
      content_generation: doc.content_generation,
      payload: bad_bytes
    )

    event = assert_notification("fold.yjs", outcome: "folded", integrated: 0, retained: 0, quarantined: 1) do
      YjsPersistence.fold!(doc)
    end
    assert_equal 1, event.payload[:rows]

    doc.reload
    assert_not doc.yjs_document_updates.exists?, "poison-pill rows must be deleted immediately, not retained for ORPHAN_TTL"
    assert_equal before_state, doc.yjs_state, "poison-pill-only fold must not rewrite yjs_state"
    assert_not doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).exists?,
               "poison-pill-only fold must not create a spurious checkpoint"

    quarantined = doc.yjs_state_archives.where(kind: YjsStateArchive::QUARANTINE).sole
    assert_equal bad_bytes, quarantined.yjs_state
    assert_match(/undecodable update row/, quarantined.error)
  end

  test "a poison-pill row alongside valid rows quarantines the poison pill and integrates valid updates" do
    doc = Document.create!(title: "MixedPoison")
    doc.yjs_document_updates.create!(
      content_generation: doc.content_generation,
      payload: "corrupt-bytes".b
    )
    YjsPersistence.merge(doc, b64_update_for("good edit"))

    assert_notification("fold.yjs", outcome: "folded", integrated: 1, retained: 0, quarantined: 1) do
      YjsPersistence.fold!(doc)
    end

    assert_not doc.reload.yjs_document_updates.exists?
    assert_equal "good edit", text_of(doc)
    assert_equal 1, doc.yjs_state_archives.where(kind: YjsStateArchive::QUARANTINE).count
  end

  test "re-folding a multi-client doc with retained pending rows does not rewrite yjs_state or checkpoint" do
    doc = Document.create!(title: "NoPhantomWrite")
    c1 = Y::Doc.new(100)
    c1.get_text("t") << "alpha "
    c2 = Y::Doc.new(200)
    c2.get_text("t") << "beta"
    YjsPersistence.merge(doc, Base64.strict_encode64(c1.encode_state_as_update))
    YjsPersistence.merge(doc, Base64.strict_encode64(c2.encode_state_as_update))
    YjsPersistence.fold!(doc)

    # Rewrite stored bytes with clients in the reverse encoding order to
    # simulate non-deterministic cross-process yrs HashMap serialization where
    # blob != document.yjs_state despite identical CRDT state.
    reordered_doc = Y::Doc.new
    reordered_doc.apply_update(c2.encode_state_as_update)
    reordered_doc.apply_update(c1.encode_state_as_update)
    reordered_blob = reordered_doc.compacted_state_update
    doc.reload.update_columns(
      yjs_state: reordered_blob,
      yjs_state_vector: reordered_doc.encode_state_vector,
      yjs_state_checksum: YjsRecovery.state_checksum(reordered_blob)
    )
    stored_blob = doc.yjs_state
    stored_checksum = doc.yjs_state_checksum

    # Append a causally-pending row that cannot integrate.
    c3 = Y::Doc.new(300)
    c3.get_text("t") << "root"
    sv3 = c3.encode_state_vector
    c3.get_text("t") << "child"
    pending_update = c3.encode_state_as_update(sv3)
    YjsPersistence.merge(doc, Base64.strict_encode64(pending_update))

    event = assert_notification("fold.yjs", outcome: "folded", integrated: 0, retained: 1) do
      YjsPersistence.fold!(doc)
    end
    assert_nil event.payload[:blob_bytes_after], "no-op fold must not report a persisted blob rewrite"

    doc.reload
    assert_equal stored_blob, doc.yjs_state, "non-deterministic serialization must not trigger a phantom rewrite"
    assert_equal stored_checksum, doc.yjs_state_checksum
    assert_not doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).exists?,
               "no-op fold must not write a checkpoint"
  end

  test "a duplicate echo row is deleted without rewriting yjs_state or checkpointing" do
    doc = Document.create!(title: "NoopEcho")
    client = Y::Doc.new(100)
    client.get_text("t") << "hello"
    YjsPersistence.merge(doc, Base64.strict_encode64(client.encode_state_as_update))
    YjsPersistence.fold!(doc)

    stored_blob = doc.reload.yjs_state
    stored_checksum = doc.yjs_state_checksum

    YjsPersistence.merge(doc, Base64.strict_encode64(client.encode_state_as_update))
    event = assert_notification("fold.yjs", outcome: "folded", integrated: 1, retained: 0) do
      YjsPersistence.fold!(doc)
    end
    assert_nil event.payload[:blob_bytes_after]

    doc.reload
    assert_not doc.yjs_document_updates.exists?
    assert_equal stored_blob, doc.yjs_state
    assert_equal stored_checksum, doc.yjs_state_checksum
    assert_not doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).exists?
  end

  test "a mixed frame with integrated delete and pending insert persists the delete on first fold and skips rewrite on second" do
    doc = Document.create!(title: "MixedDeletePending")
    c1 = Y::Doc.new(100)
    c1.get_text("t") << "keep-me"
    YjsPersistence.merge(doc, Base64.strict_encode64(c1.encode_state_as_update))
    YjsPersistence.fold!(doc)

    sv1 = c1.encode_state_vector
    c1.get_text("t").delete(4, 3)
    delete_u1 = c1.encode_state_as_update(sv1)

    c2 = Y::Doc.new(200)
    c2.get_text("t") << "root"
    sv2 = c2.encode_state_vector
    c2.get_text("t") << "dep"
    pending_u2 = c2.encode_state_as_update(sv2)

    mixed_doc = Y::Doc.new
    mixed_doc.apply_update(delete_u1)
    mixed_doc.apply_update(pending_u2)
    YjsPersistence.merge(doc, Base64.strict_encode64(mixed_doc.encode_state_as_update))

    first = assert_notification("fold.yjs", outcome: "folded", retained: 1) { YjsPersistence.fold!(doc) }
    assert first.payload[:blob_bytes_after].present?, "the integrated delete must persist on the first fold"
    assert_equal "keep", text_of(doc)

    # Second fold while the pending half is still missing must not rewrite or checkpoint again.
    checkpoints_after_first = doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).count
    travel YjsPersistence::CHECKPOINT_INTERVAL + 1.minute do
      second = assert_notification("fold.yjs", outcome: "folded", retained: 1) { YjsPersistence.fold!(doc.reload) }
      assert_nil second.payload[:blob_bytes_after]
    end
    assert_equal checkpoints_after_first, doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).count
  end

  test "gapped fold verifies blob once by reusing the base Y::Doc" do
    doc = Document.create!(title: "SingleDocVerify")
    c1 = Y::Doc.new(100)
    c1.get_text("t") << "integrated"
    YjsPersistence.merge(doc, Base64.strict_encode64(c1.encode_state_as_update))

    c2 = Y::Doc.new(200)
    c2.get_text("t") << "root"
    sv2 = c2.encode_state_vector
    c2.get_text("t") << "pending"
    YjsPersistence.merge(doc, Base64.strict_encode64(c2.encode_state_as_update(sv2)))

    doc_allocations = 0
    original_new = Y::Doc.method(:new)
    Y::Doc.define_singleton_method(:new) do |*args, **kwargs|
      doc_allocations += 1
      original_new.call(*args, **kwargs)
    end
    begin
      YjsPersistence.fold!(doc)
    ensure
      Y::Doc.define_singleton_method(:new, original_new)
    end

    # Exactly 2 Y::Doc instances: 1 for load_ydoc and 1 reused `base` doc
    # verifying `blob` and classifying rows (never a 3rd doc for blob_loadable?).
    assert_equal 2, doc_allocations
    assert_equal "integrated", text_of(doc)
  end

  test "lock table is a fixed 64-stripe bounded array" do
    assert_instance_of Array, YjsPersistence::LOCKS
    assert_equal 64, YjsPersistence::LOCKS.length
    assert YjsPersistence::LOCKS.frozen?
    assert YjsPersistence::LOCKS.all? { |mutex| mutex.is_a?(Mutex) }

    lock_a = YjsPersistence.send(:lock_for, 1)
    lock_b = YjsPersistence.send(:lock_for, 2)
    lock_same_stripe = YjsPersistence.send(:lock_for, 1 + YjsPersistence::LOCK_STRIPES)

    assert_same lock_a, lock_same_stripe
    assert_not_same lock_a, lock_b
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
      yjs_state: ydoc.compacted_state_update,
      yjs_state_vector: ydoc.encode_state_vector
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
        state_vector_b64: Base64.strict_encode64(Y::Doc.new.encode_state_vector),
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
      state_vector_b64: Base64.strict_encode64(Y::Doc.new.encode_state_vector),
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
    client.apply_update(Base64.strict_decode64(full_state))
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

  test "a handshake serves state another connection folded after this row was loaded" do
    doc = Document.create!(title: "Folded underneath")
    joining = Document.find(doc.id)
    YjsPersistence.merge(doc, b64_update_for("stored content"))
    YjsPersistence.fold!(doc)

    full_b64, = YjsPersistence.state_b64(joining)
    client = Y::Doc.new
    client.apply_update(Base64.strict_decode64(full_b64))
    assert_equal "stored content", client.get_text("t").to_s
  end

  test "a differential handshake serves state another connection folded after this row was loaded" do
    doc = Document.create!(title: "Folded underneath")
    joining = Document.find(doc.id)
    YjsPersistence.merge(doc, b64_update_for("stored content"))
    YjsPersistence.fold!(doc)

    other = Y::Doc.new
    other.get_text("other") << "x"
    diff_b64, = YjsPersistence.diff_b64(joining, Base64.strict_encode64(other.encode_state_vector))
    client = Y::Doc.new
    client.apply_update(Base64.strict_decode64(diff_b64))
    assert_equal "stored content", client.get_text("t").to_s
  end

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
    client.apply_update(doc.yjs_state)
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
    client.apply_update(Base64.strict_decode64(full_state))
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
    client.apply_update(Base64.strict_decode64(full_state))
    assert_equal "old row", client.get_text("t").to_s
    assert state_vector.present?
  end

  test "diff_b64 returns only the missing delta for a behind client" do
    doc = Document.create!(title: "Diff")
    author = Y::Doc.new
    author.get_text("t") << ("base paragraph " * 50)
    base_update = author.encode_state_as_update
    client_sv = author.encode_state_vector

    YjsPersistence.merge(doc, Base64.strict_encode64(base_update))
    YjsPersistence.fold!(doc)

    author.get_text("t") << "tail edit"
    YjsPersistence.merge(doc, Base64.strict_encode64(author.encode_state_as_update(client_sv)))
    fold_and_reload(doc)

    full_state, = YjsPersistence.state_b64(doc)
    delta = nil
    server_sv = nil
    assert_notification("state.yjs", served_from: "diff", outcome: "ok") do
      delta, server_sv = YjsPersistence.diff_b64(doc, Base64.strict_encode64(client_sv))
    end

    assert_operator Base64.strict_decode64(delta).bytesize, :<, Base64.strict_decode64(full_state).bytesize
    assert_equal Base64.strict_encode64(doc.yjs_state_vector), server_sv

    client = Y::Doc.new
    client.apply_update(base_update)
    client.apply_update(Base64.strict_decode64(delta))
    assert_equal ("base paragraph " * 50) + "tail edit", client.get_text("t").to_s
  end

  test "diff_b64 folds an unfolded tail and delivers missing deletes even when state vectors match" do
    doc = Document.create!(title: "DeleteDiff")
    author = Y::Doc.new
    author.get_text("t") << "hello world"
    base_update = author.encode_state_as_update
    sv_before_delete = author.encode_state_vector

    YjsPersistence.merge(doc, Base64.strict_encode64(base_update))
    YjsPersistence.fold!(doc)

    author.get_text("t").delete(5, 6)
    YjsPersistence.merge(doc, Base64.strict_encode64(author.encode_state_as_update(sv_before_delete)))
    assert doc.reload.yjs_document_updates.exists?

    delta = nil
    assert_notification("state.yjs", served_from: "diff_fold", outcome: "ok") do
      delta, = YjsPersistence.diff_b64(doc, Base64.strict_encode64(sv_before_delete))
    end

    client = Y::Doc.new
    client.apply_update(base_update)
    client.apply_update(Base64.strict_decode64(delta))
    assert_equal "hello", client.get_text("t").to_s
  end

  test "diff_b64 delegates empty state vector to state_b64 without building a Y::Doc" do
    doc = Document.create!(title: "ColdDiff")
    YjsPersistence.merge(doc, b64_update_for("column served"))
    fold_and_reload(doc)
    empty_sv = Base64.strict_encode64(YjsPersistence::EMPTY_STATE_VECTOR)

    original = Y::Doc.method(:new)
    Y::Doc.define_singleton_method(:new) { |*| raise "empty sv diff must use columns fast path" }
    begin
      assert_notification("state.yjs", served_from: "columns", outcome: "ok") do
        full_state, state_vector = YjsPersistence.diff_b64(doc, empty_sv)
        assert_equal Base64.strict_encode64(doc.yjs_state), full_state
        assert_equal Base64.strict_encode64(doc.yjs_state_vector), state_vector
      end
    ensure
      Y::Doc.define_singleton_method(:new, original)
    end
  end

  test "diff_b64 falls back to full state_b64 when client state vector is malformed or blank" do
    doc = Document.create!(title: "FallbackDiff")
    YjsPersistence.merge(doc, b64_update_for("full content"))
    fold_and_reload(doc)
    expected_full, expected_sv = YjsPersistence.state_b64(doc)

    [ nil, "", "not!!base64!!", Base64.strict_encode64("\x85\xff".b) ].each do |bad_sv|
      assert_equal [ expected_full, expected_sv ], YjsPersistence.diff_b64(doc, bad_sv)
    end
  end

  test "diff_b64 serves an empty document without building a Y::Doc" do
    doc = Document.create!(title: "EmptyDiff")
    client = Y::Doc.new
    client.get_text("t") << "local only"
    client_sv = Base64.strict_encode64(client.encode_state_vector)

    original = Y::Doc.method(:new)
    Y::Doc.define_singleton_method(:new) { |*| raise "empty doc diff must not build a Y::Doc" }
    begin
      delta, sv = YjsPersistence.diff_b64(doc, client_sv)
      assert_equal Base64.strict_encode64(YjsPersistence::EMPTY_UPDATE), delta
      assert_equal Base64.strict_encode64(YjsPersistence::EMPTY_STATE_VECTOR), sv
    ensure
      Y::Doc.define_singleton_method(:new, original)
    end
  end

  test "diff_b64 heals a corrupt stored blob instead of raising" do
    doc = Document.create!(title: "CorruptDiff")
    client = Y::Doc.new
    client.get_text("t") << "seed"
    client_sv = Base64.strict_encode64(client.encode_state_vector)

    YjsPersistence.merge(doc, b64_update_for("served"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state: "garbage-bytes")

    assert_notification("recovered.yjs", restored_from: "empty") do
      delta, sv = YjsPersistence.diff_b64(doc.reload, client_sv)
      assert delta.present?
      assert sv.present?
    end
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
    stale_vector = Base64.strict_encode64(Y::Doc.new.encode_state_vector)

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
    snapshot_only_vector = Base64.strict_encode64(doc_from(doc).encode_state_vector)

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

    stale_vector = Base64.strict_encode64(Y::Doc.new.encode_state_vector)
    assert_not YjsPersistence.persist_snapshot(
      doc.reload, state_vector_b64: stale_vector, content: "stale", spans: []
    ), "a behind client must still be rejected when the stored vector is corrupt"

    current_vector = Base64.strict_encode64(client.encode_state_vector)
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
    stale_vector = Base64.strict_encode64(Y::Doc.new.encode_state_vector)

    persisted = YjsPersistence.persist_snapshot(
      doc.reload, state_vector_b64: stale_vector, content: "stale", spans: []
    )

    assert_not persisted
    assert_equal "current", doc.reload.content_snapshot
  end

  test "snapshot persistence rejects a client behind the current Yjs state" do
    doc = Document.create!(title: "Snapshot", content_snapshot: "current")
    YjsPersistence.merge(doc, b64_update_for("server content"))
    stale_vector = Base64.strict_encode64(Y::Doc.new.encode_state_vector)

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
    client_vector = Base64.strict_encode64(client.encode_state_vector)

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
    server.apply_update(doc.yjs_state)
    entries = decode_state_vector_for_test(server.encode_state_vector.unpack("C*")).to_a.reverse
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

  # --- Compaction -------------------------------------------------------------

  test "compact! folds the tail and re-encodes without changing content" do
    doc = Document.create!(title: "Compacted")
    client = Y::Doc.new
    YjsPersistence.merge(doc, b64_update_for("first ", from_doc: client))
    YjsPersistence.merge(doc, b64_update_for("second", from_doc: client))
    assert doc.yjs_document_updates.exists?

    result = nil
    event = assert_notification("compact.yjs") { result = YjsPersistence.compact!(doc) }
    doc.reload

    assert_not doc.yjs_document_updates.exists?, "compaction folds the tail"
    assert_equal "first second", text_of(doc)
    assert_equal Digest::SHA256.hexdigest(doc.yjs_state), doc.yjs_state_checksum
    assert_equal doc_from(doc).encode_state_vector, doc.yjs_state_vector
    assert_equal doc.yjs_state.bytesize, result[:after_bytes]
    assert_equal result[:outcome], event.payload[:outcome]
  end

  test "compact! is a no-op the second time and never archives an unchanged blob" do
    doc = Document.create!(title: "Idempotent")
    YjsPersistence.merge(doc, b64_update_for("stable"))
    YjsPersistence.compact!(doc)
    blob, vector, checksum = doc.reload.values_at(:yjs_state, :yjs_state_vector, :yjs_state_checksum)

    result = YjsPersistence.compact!(doc)
    doc.reload

    assert_equal "unchanged", result[:outcome]
    assert_not result[:changed]
    assert_equal [ blob, vector, checksum ], doc.values_at(:yjs_state, :yjs_state_vector, :yjs_state_checksum)
    assert_not doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).exists?,
               "an unchanged compaction must not archive"
  end

  test "compact! stamps a legacy row's missing vector and checksum without rewriting the blob" do
    doc = Document.create!(title: "Legacy")
    YjsPersistence.merge(doc, b64_update_for("hello world"))
    YjsPersistence.fold!(doc)
    blob = doc.reload.yjs_state
    doc.update_columns(yjs_state_vector: nil, yjs_state_checksum: nil)

    result = YjsPersistence.compact!(doc)
    doc.reload

    assert_equal "stamped", result[:outcome]
    assert result[:changed]
    assert_equal blob, doc.yjs_state, "an equal-size re-encoding is not written over the stored blob"
    assert_equal "hello world", text_of(doc)
    assert_equal doc_from(doc).encode_state_vector, doc.yjs_state_vector
    assert_equal Digest::SHA256.hexdigest(blob), doc.yjs_state_checksum
    assert_not doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).exists?

    assert_equal "unchanged", YjsPersistence.compact!(doc)[:outcome]
  end

  test "compact! shrinks a blob that still carries deleted content and keeps the old one as a checkpoint" do
    doc = Document.create!(title: "Tombstones")
    client = Y::Doc.new
    client.get_text("t") << ("x" * 5000)
    insert_update = client.encode_state_as_update
    sv_after_insert = client.encode_state_vector
    client.get_text("t").delete(0, 4990)
    delete_update = client.encode_state_as_update(sv_after_insert)

    # Combine raw structs (without empty trailing delete-set byte) and raw
    # delete set (without leading zero struct-count byte) to build a valid
    # un-GC'd Yjs v1 update whose deleted characters are still present verbatim.
    bloated = insert_update.byteslice(0, insert_update.bytesize - 1) +
              delete_update.byteslice(1, delete_update.bytesize - 1)
    doc.update_columns(yjs_state: bloated, yjs_state_vector: client.encode_state_vector,
                       yjs_state_checksum: Digest::SHA256.hexdigest(bloated))
    before = bloated.bytesize

    result = YjsPersistence.compact!(doc)
    doc.reload

    assert_equal "compacted", result[:outcome]
    assert result[:changed]
    assert_equal "x" * 10, text_of(doc)
    assert_operator doc.yjs_state.bytesize, :<, before, "deleted content must not survive compaction"
    assert_equal Digest::SHA256.hexdigest(doc.yjs_state), doc.yjs_state_checksum
    assert_equal bloated, doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).sole.yjs_state
    assert_equal "unchanged", YjsPersistence.compact!(doc)[:outcome]
  end

  test "compact! on a document with no state reports empty and writes nothing" do
    doc = Document.create!(title: "Blank")

    result = YjsPersistence.compact!(doc)

    assert_equal({ before_bytes: 0, after_bytes: 0, changed: false, outcome: "empty" }, result)
    assert_nil doc.reload.yjs_state
  end

  test "compact! reports a corrupt blob as healed instead of stamping the emptied state" do
    doc = Document.create!(title: "Corrupt")
    YjsPersistence.merge(doc, b64_update_for("content"))
    YjsPersistence.fold!(doc)
    doc.reload.update_columns(yjs_state: "garbage-bytes", yjs_state_checksum: Digest::SHA256.hexdigest("garbage-bytes"))

    result = assert_notification("recovered.yjs", restored_from: "empty") { YjsPersistence.compact!(doc) }
      .then { YjsPersistence.compact!(doc) }
    doc.reload

    assert_equal "empty", result[:outcome], "a second run on the emptied document is empty"
    assert_nil doc.yjs_state
    assert_nil doc.yjs_state_vector, "no vector may be stamped onto a document with no state"
    assert_nil doc.yjs_state_checksum
    assert doc.yjs_state_archives.where(kind: YjsStateArchive::QUARANTINE).exists?
  end

  test "compact! reports healed when the load restored a checkpoint" do
    doc = Document.create!(title: "Restored")
    YjsPersistence.merge(doc, b64_update_for("checkpointed"))
    YjsPersistence.fold!(doc)
    YjsPersistence.merge(doc, b64_update_for(" and more"))
    YjsPersistence.fold!(doc) # a checkpoint of the first fold's blob exists now
    doc.reload.update_columns(yjs_state: "garbage-bytes-of-a-different-length",
                              yjs_state_checksum: Digest::SHA256.hexdigest("garbage-bytes-of-a-different-length"))

    result = YjsPersistence.compact!(doc)
    doc.reload

    assert_equal "healed", result[:outcome]
    assert result[:changed]
    assert_equal "garbage-bytes-of-a-different-length".bytesize, result[:before_bytes]
    assert_equal doc.yjs_state.bytesize, result[:after_bytes]
    assert_includes text_of(doc), "checkpointed"
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
    empty_update = Base64.strict_encode64(Y::Doc.new.compacted_state_update)

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
    stale_vector = Base64.strict_encode64(Y::Doc.new.encode_state_vector)

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
