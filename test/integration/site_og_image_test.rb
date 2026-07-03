require "test_helper"

class SiteOgImageIntegrationTest < ActionDispatch::IntegrationTest
  PNG_BYTES = "\x89PNG\r\n\x1A\nstub".b

  test "serves a public inline PNG without minting a cookie" do
    with_stubbed_image do
      get site_og_image_path, headers: { "User-Agent" => "Twitterbot/1.0" }
    end

    assert_response :success
    assert_equal "image/png", response.media_type
    assert response.body.b.start_with?("\x89PNG\r\n\x1A\n".b)
    assert_includes response.headers["Content-Disposition"], "inline"
    assert_includes response.headers["Cache-Control"], "public"
    assert response.headers["ETag"].present?
    assert response.headers["Set-Cookie"].blank?
    assert_not SiteOgImagesController.allow_forgery_protection
  end

  test "honors the image ETag" do
    with_stubbed_image do
      get site_og_image_path
      etag = response.headers.fetch("ETag")

      get site_og_image_path, headers: { "If-None-Match" => etag }
    end

    assert_response :not_modified
    assert_empty response.body
  end

  private

  def with_stubbed_image
    original = SiteOgImage.method(:call)
    SiteOgImage.define_singleton_method(:call) { PNG_BYTES }
    yield
  ensure
    SiteOgImage.define_singleton_method(:call, original)
  end
end
