require "test_helper"
require "open3"

class SiteOgImageServiceTest < ActiveSupport::TestCase
  test "renders a social-compatible PNG at the declared dimensions" do
    script = <<~'RUBY'
      png = SiteOgImage.call
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
    assert_equal SiteOgImage::WIDTH, result["width"]
    assert_equal SiteOgImage::HEIGHT, result["height"]
  end

  test "renders the wordmark, tagline, and byline" do
    svg = SiteOgImage.send(:svg)

    assert_includes svg, ">Thinkroom<"
    assert_includes svg, ">Where deeper thinking</tspan>"
    assert_includes svg, ">compounds.</tspan>"
    assert_includes svg, "From the creator of Compound Engineering."
    refute_includes svg, "\#{"
  end

  test "tagline lines fit the shared title measure" do
    SiteOgImage::TITLE_LINES.each do |line|
      assert_operator DocumentOgImage.send(:visual_width, line),
                      :<=, DocumentOgImage::TITLE_LINE_WIDTH
    end
  end

  test "cache identity embeds the renderer version" do
    assert_includes SiteOgImage.cache_key, SiteOgImage::VERSION
  end
end
