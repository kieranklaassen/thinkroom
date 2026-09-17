require "test_helper"
require "rake"

class YjsTasksTest < ActiveSupport::TestCase
  setup do
    Rake.application = Rake::Application.new
    Rails.application.load_tasks
  end

  def run_task(name, *args)
    task = Rake::Task[name]
    task.reenable
    output = StringIO.new
    $stdout = output
    task.invoke(*args)
    output.string
  ensure
    $stdout = STDOUT
  end

  def state_text(document)
    full_state, = YjsPersistence.state_b64(document.reload)
    ydoc = Y::Doc.new
    ydoc.sync(Base64.strict_decode64(full_state).unpack("C*"))
    ydoc.get_text("t").to_s
  end

  def update_for(text)
    ydoc = Y::Doc.new
    ydoc.get_text("t") << text
    Base64.strict_encode64(ydoc.diff.pack("C*"))
  end

  test "yjs:compact folds and re-encodes, reporting sizes" do
    doc = Document.create!(title: "Compact me")
    YjsPersistence.merge(doc, update_for("live text"))

    output = run_task("yjs:compact", doc.slug)

    # The fold that precedes the re-encode already writes the canonical
    # blob, so a healthy document reports unchanged; the tail is gone either way.
    assert_match(/yjs:compact #{doc.slug} \(id #{doc.id}\): \d+ -> \d+ bytes, (compacted|unchanged)/, output)
    assert_not doc.yjs_document_updates.exists?
    assert_equal "live text", state_text(doc)
    assert_match(/unchanged/, run_task("yjs:compact", doc.slug), "a second run is a no-op")
  end

  test "yjs:reset replaces the live state with the saved source and archives the old state" do
    doc = Document.create!(title: "Reset me", seed_markdown: "# Seed")
    YjsPersistence.merge(doc, update_for("huge pasted state"))
    YjsPersistence.persist_snapshot(doc, state_vector_b64: nil, content: "# Saved copy", spans: [])
    generation = doc.reload.content_generation

    output = run_task("yjs:reset", doc.slug)
    doc.reload

    assert_match(/yjs:reset #{doc.slug} \(id #{doc.id}\): archived \d+ bytes of state, generation #{generation + 1}/, output)
    assert_nil doc.yjs_state, "the live CRDT is wiped"
    assert_not doc.yjs_document_updates.exists?
    assert_equal generation + 1, doc.content_generation
    assert_equal "# Saved copy", doc.seed_content, "the last accepted source becomes the new seed"
    assert_nil doc.content_snapshot
    assert_equal "pending", doc.seed_state
    archive = doc.yjs_state_archives.where(kind: YjsStateArchive::REPLACEMENT).sole
    assert_equal generation, archive.content_generation
    assert archive.yjs_state.present?, "the wiped state is recoverable from the archive"
  end

  test "yjs:reset falls back to the seed when no snapshot was ever accepted" do
    doc = Document.create!(title: "Template only", seed_markdown: "# Template")
    YjsPersistence.merge(doc, update_for("state the snapshot never captured"))

    run_task("yjs:reset", doc.slug)

    assert_equal "# Template", doc.reload.seed_content
    assert_nil doc.yjs_state
  end

  test "yjs:reset seeds the default template when the document has neither snapshot nor seed" do
    doc = Document.create!(title: "Legacy", seed_markdown: nil)
    YjsPersistence.merge(doc, update_for("only ever lived in the CRDT"))

    run_task("yjs:reset", doc.slug)

    assert_equal Document::DEFAULT_SEED, doc.reload.seed_content
    assert_nil doc.yjs_state
  end

  test "both tasks fail loudly on an unknown slug" do
    assert_raises(ActiveRecord::RecordNotFound) { run_task("yjs:compact", "missing") }
    assert_raises(ActiveRecord::RecordNotFound) { run_task("yjs:reset", "missing") }
  end
end
