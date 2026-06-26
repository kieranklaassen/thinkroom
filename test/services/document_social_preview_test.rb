require "test_helper"

class DocumentSocialPreviewTest < ActiveSupport::TestCase
  test "uses the display title and removes it from the body excerpt" do
    document = Document.create!(
      title: "Stored fallback",
      seed_content: "# Product & market\n\nA focused explanation of the opportunity."
    )

    preview = DocumentSocialPreview.new(document)

    assert_equal "Product & market", preview.title
    assert_equal "A focused explanation of the opportunity.", preview.description
  end

  test "projects HTML and sketch-aware content to plain text" do
    document = Document.create!(
      title: "HTML fallback",
      content_format: "html",
      seed_content: "<h1>Launch notes</h1><p>Ship <strong>carefully</strong> &amp; learn.</p>"
    )

    preview = DocumentSocialPreview.new(document)

    assert_equal "Launch notes", preview.title
    assert_equal "Ship carefully & learn.", preview.description
    refute_includes preview.description, "<strong>"
  end

  test "bounds long unicode copy without splitting a grapheme" do
    grapheme = "e\u0301"
    document = Document.create!(
      title: grapheme * 220,
      seed_content: "Plain body"
    )

    preview = DocumentSocialPreview.new(document)

    assert_operator preview.title.scan(/\X/).length, :<=,
                    DocumentSocialPreview::TITLE_MAX_GRAPHEMES
    assert_equal grapheme, preview.title.scan(/\X/).last(2).first
    assert_equal "…", preview.title.scan(/\X/).last
  end

  test "falls back to the title for a title-only document" do
    document = Document.create!(title: "Only title", seed_content: "")

    preview = DocumentSocialPreview.new(document)

    assert_equal "Only title", preview.title
    assert_equal "Only title", preview.description
  end

  test "removes an unbounded long heading before truncating the excerpt" do
    heading = "A" * 200
    document = Document.create!(
      title: "Fallback",
      seed_content: "# #{heading}\n\nThe actual body should lead the card."
    )

    preview = DocumentSocialPreview.new(document)

    assert preview.title.end_with?("…")
    assert_equal "The actual body should lead the card.", preview.description
  end

  test "does not remove a stored title that is only a body-word prefix" do
    document = Document.create!(title: "Plan", seed_content: "Planet-scale ideas need context.")

    preview = DocumentSocialPreview.new(document)

    assert_equal "Plan", preview.title
    assert_equal "Planet-scale ideas need context.", preview.description
  end
end
