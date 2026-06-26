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
end
