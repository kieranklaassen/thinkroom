require "test_helper"
require "open3"

class DocumentOgImageServiceTest < ActiveSupport::TestCase
  test "renders a social-compatible PNG at the declared dimensions" do
    script = <<~'RUBY'
      document = Document.new(
        title: "Fallback",
        content_format: "markdown",
        seed_content: "# A minimal <plan> & review\n\nText with symbols: © → ✓"
      )
      png = DocumentOgImage.call(document)
      image = Vips::Image.new_from_buffer(png, "")
      puts JSON.generate(
        png: png.start_with?("\x89PNG\r\n\x1A\n".b),
        width: image.width,
        height: image.height
      )
    RUBY

    stdout, stderr, status = Open3.capture3(
      { "RAILS_ENV" => "test" }, Rails.root.join("bin/rails").to_s, "runner", script
    )
    assert status.success?, stderr
    result = JSON.parse(stdout)

    assert result["png"]
    assert_equal DocumentOgImage::WIDTH, result["width"]
    assert_equal DocumentOgImage::HEIGHT, result["height"]
  end

  test "cache identity and URL version change with the document version" do
    document = Document.create!(title: "First", seed_content: "Body")
    first_key = DocumentOgImage.cache_key(document)
    first_version = DocumentOgImage.url_version(document)

    travel 1.second do
      document.update!(title: "Second")
    end

    refute_equal first_key, DocumentOgImage.cache_key(document)
    refute_equal first_version, DocumentOgImage.url_version(document)
  end

  test "wraps wide glyphs within the image's visual line budget" do
    lines = DocumentOgImage.send(
      :wrap,
      "W" * 80,
      width: DocumentOgImage::TITLE_LINE_WIDTH,
      maximum: DocumentOgImage::TITLE_MAX_LINES
    )

    assert_equal DocumentOgImage::TITLE_MAX_LINES, lines.length
    assert lines.last.end_with?("…")
    assert lines.all? do |line|
      DocumentOgImage.send(:visual_width, line) <= DocumentOgImage::TITLE_LINE_WIDTH
    end
  end

  test "renders source context and an honest call to action" do
    document = Document.new(title: "Plan", seed_content: "# Plan\n\nA useful summary")
    svg = DocumentOgImage.send(:svg, document)

    assert_includes svg, "THINKROOM · SHARED DOCUMENT"
    assert_includes svg, "Open document →"
    assert_includes svg, "A place for deeper thinking"
    refute_includes svg, "owner_token"
  end

  test "keeps the excerpt out of the card's right gutter" do
    script = <<~'RUBY'
      document = Document.new(
        title: "The Proof Demo Document",
        seed_content: "# The Proof Demo Document\n\nWelcome — this document is live. Open this page in a second window and watch edits flow both ways. Everything you type is attributed to you."
      )
      svg = DocumentOgImage.send(:svg, document)
      image = Vips::Image.svgload_buffer(svg, access: :sequential)
      # Stop before the rounded card border's antialiasing at x=1152.
      right_gutter = image.crop(1120, 230, 12, 250)
      card_fill = [255, 253, 249, 255]
      puts JSON.generate(max_delta: (right_gutter - card_fill).abs.max)
    RUBY

    stdout, stderr, status = Open3.capture3(
      { "RAILS_ENV" => "test" }, Rails.root.join("bin/rails").to_s, "runner", script
    )
    assert status.success?, stderr

    assert_equal 0, JSON.parse(stdout)["max_delta"]
  end
end
