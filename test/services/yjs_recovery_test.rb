require "test_helper"

class YjsRecoveryTest < ActiveSupport::TestCase
  def b64_update_for(text, from_doc: nil)
    ydoc = from_doc || Y::Doc.new
    ydoc.get_text("t") << text
    Base64.strict_encode64(ydoc.encode_state_as_update)
  end

  test "state_checksum and verify_checksum! validate matching and reject mismatched blobs" do
    doc = Document.create!(title: "Checksum")
    YjsPersistence.merge(doc, b64_update_for("checksummed"))
    YjsPersistence.fold!(doc)
    doc.reload

    assert_equal Digest::SHA256.hexdigest(doc.yjs_state), YjsRecovery.state_checksum(doc.yjs_state)
    assert_nothing_raised { YjsRecovery.verify_checksum!(doc) }

    doc.yjs_state_checksum = "0" * 64
    assert_raises(YjsPersistence::CorruptStateError) { YjsRecovery.verify_checksum!(doc) }

    doc.yjs_state_checksum = nil
    assert_nothing_raised { YjsRecovery.verify_checksum!(doc) }
  end

  test "maybe_checkpoint is interval-gated per generation" do
    doc = Document.create!(title: "Checkpoint")
    YjsPersistence.merge(doc, b64_update_for("initial"))
    YjsPersistence.fold!(doc)
    doc.reload

    YjsRecovery.maybe_checkpoint(doc)
    YjsRecovery.maybe_checkpoint(doc)
    assert_equal 1, doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).count

    travel YjsRecovery::CHECKPOINT_INTERVAL + 1.minute do
      YjsRecovery.maybe_checkpoint(doc)
    end
    assert_equal 2, doc.yjs_state_archives.where(kind: YjsStateArchive::CHECKPOINT).count
  end

  test "quarantine_poison_pills archives undecodable rows as QUARANTINE and deletes them" do
    doc = Document.create!(title: "Quarantine")
    row = doc.yjs_document_updates.create!(
      content_generation: doc.content_generation,
      payload: "bad-bytes".b
    )

    YjsRecovery.quarantine_poison_pills(doc, [ [ row, RuntimeError.new("decode failed") ] ])

    assert_not doc.yjs_document_updates.exists?
    archive = doc.yjs_state_archives.where(kind: YjsStateArchive::QUARANTINE).sole
    assert_equal "bad-bytes".b, archive.yjs_state
    assert_includes archive.error, "RuntimeError: decode failed"
  end

  test "quarantine_orphans evicts only rows older than ORPHAN_TTL" do
    doc = Document.create!(title: "Orphans")
    old_row = doc.yjs_document_updates.create!(
      content_generation: doc.content_generation,
      payload: "old".b,
      created_at: (YjsRecovery::ORPHAN_TTL + 5.minutes).ago
    )
    fresh_row = doc.yjs_document_updates.create!(
      content_generation: doc.content_generation,
      payload: "fresh".b
    )
    retained = [ old_row, fresh_row ]

    YjsRecovery.quarantine_orphans(doc, retained)

    assert_equal [ fresh_row ], retained
    assert_equal [ fresh_row.id ], doc.yjs_document_updates.pluck(:id)
    assert_equal "old".b, doc.yjs_state_archives.where(kind: YjsStateArchive::ORPHAN).sole.yjs_state
  end

  test "YjsPersistence.compact! delegates cleanly to YjsRecovery.compact!" do
    doc = Document.create!(title: "Delegate")
    YjsPersistence.merge(doc, b64_update_for("content"))

    result = YjsPersistence.compact!(doc)
    assert_equal "unchanged", result[:outcome]
    assert_equal "unchanged", YjsRecovery.compact!(doc)[:outcome]
  end
end
