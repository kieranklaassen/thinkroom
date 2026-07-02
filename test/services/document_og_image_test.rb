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

  test "renders the wordmark, source label, and tagline for an unattributed document" do
    document = Document.new(title: "Plan", seed_content: "# Plan\n\nA useful summary")
    svg = DocumentOgImage.send(:svg, document)

    assert_includes svg, ">Thinkroom<"
    assert_includes svg, "SHARED DOCUMENT"
    assert_includes svg, "A place for deeper thinking"
    refute_includes svg, "owner_token"
  end

  test "renders the author and labels when the document carries them" do
    document = Document.new(
      slug: "abc123",
      title: "Roadmap",
      owner_name: "Ada Lovelace",
      tags: [ "Planning", "Q3" ],
      seed_content: "# Roadmap\n\nWhere we are headed."
    )
    svg = DocumentOgImage.send(:svg, document)

    assert_includes svg, ">Ada Lovelace<"
    assert_includes svg, ">A<" # avatar initial
    assert_includes svg, ">Planning<"
    assert_includes svg, ">Q3<"
    refute_includes svg, "A place for deeper thinking"
  end

  test "escapes user-authored copy in the SVG" do
    document = Document.new(
      title: "Tom & Jerry <plan>",
      owner_name: "A & B",
      tags: [ "<tag>" ],
      seed_content: "Body & <markup>"
    )
    svg = DocumentOgImage.send(:svg, document)

    assert_includes svg, "Tom &amp; Jerry &lt;plan&gt;"
    refute_includes svg, "<plan>"
    refute_includes svg, "<tag>"
  end

  test "keeps the excerpt out of the card's right gutter" do
    script = <<~'RUBY'
      document = Document.new(
        title: "The Proof Demo Document",
        seed_content: "# The Proof Demo Document\n\nWelcome — this document is live. Open this page in a second window and watch edits flow both ways. Everything you type is attributed to you."
      )
      svg = DocumentOgImage.send(:svg, document)
      image = Vips::Image.svgload_buffer(svg, access: :sequential)
      # The title/excerpt must stay left of the right whitespace; this band sits
      # between the header eyebrow and the footer, so it is pure background.
      right_gutter = image.crop(1120, 230, 12, 250)
      background = [251, 250, 247, 255]
      puts JSON.generate(max_delta: (right_gutter - background).abs.max)
    RUBY

    stdout, stderr, status = Open3.capture3(
      { "RAILS_ENV" => "test" }, Rails.root.join("bin/rails").to_s, "runner", script
    )
    assert status.success?, stderr

    assert_equal 0, JSON.parse(stdout)["max_delta"]
  end
end
