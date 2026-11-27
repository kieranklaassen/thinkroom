require "test_helper"
require_relative "../test_helpers/own_process_helpers"

class SiteOgImageServiceTest < ActiveSupport::TestCase
  include OwnProcessHelpers

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

    stdout = run_in_own_rails(script)
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

  test "cache identity and URL version track both renderer versions" do
    assert_includes SiteOgImage.cache_key, SiteOgImage.url_version
    assert_includes SiteOgImage.url_version, SiteOgImage::VERSION
    assert_includes SiteOgImage.url_version, DocumentOgImage::VERSION
  end

  test "tagline lines fit the shared title measure" do
    assert_equal SiteOgImage::TAGLINE, SiteOgImage::TITLE_LINES.join(" ")
    SiteOgImage::TITLE_LINES.each do |line|
      assert_operator DocumentOgImage.send(:visual_width, line),
                      :<=, DocumentOgImage::TITLE_LINE_WIDTH
    end
  end
end
