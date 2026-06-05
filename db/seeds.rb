# Demo document showcasing rich markdown plus pre-attributed AI provenance spans.
# The <span data-provenance ...> markup round-trips into editor marks (see
# app/frontend/editor/provenance). Idempotent: keyed by slug.

demo_markdown = <<~MARKDOWN
  # The Proof Demo Document

  Welcome — this document is **live**. Open this page in a second window and watch
  edits flow both ways. Everything you type is attributed to *you*; everything an
  AI contributes is tinted until a human reviews it.

  ## How provenance works

  Text carries its author with it. <span data-provenance data-kind="ai" data-author="Gemini" data-state="pending">This sentence was drafted by an AI and is still awaiting review — notice the tint.</span> Human words sit quietly, unmarked. <span data-provenance data-kind="ai" data-author="Gemini" data-state="reviewed">This AI sentence has been reviewed once, so its tint has softened.</span> And <span data-provenance data-kind="ai" data-author="Gemini" data-state="endorsed">this one has been fully endorsed</span> — only a whisper of an underline remains.

  ## Everything markdown

  - Type `##` for headings, `**bold**`, `*italic*`, and [links](https://example.com)
  - Lists, of course — including
  - Blockquotes:

  > The document is the hero. Chrome recedes.

  And code, with highlighting:

  ```ruby
  class Document < ApplicationRecord
    def provenance_summary
      spans.group_by(&:kind).transform_values { |s| s.sum(&:chars) }
    end
  end
  ```

  ## Try it

  1. Select any sentence and leave a **comment**
  2. Hit *Ask AI* and review the suggestion that arrives
  3. Share this URL with an agent — it will find its way in
MARKDOWN

doc = Document.find_or_create_by!(slug: "demo") do |d|
  d.title = "The Proof Demo Document"
  d.seed_markdown = demo_markdown
end

puts "Seeded demo document: /d/#{doc.slug}"
