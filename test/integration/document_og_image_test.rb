require "test_helper"

class DocumentOgImageIntegrationTest < ActionDispatch::IntegrationTest
  PNG_BYTES = "\x89PNG\r\n\x1A\nstub".b

  setup do
    @document = Document.create!(
      title: "Preview image",
      seed_content: "# Preview image\n\nA concise card description."
    )
  end

  test "serves a public inline PNG without minting an ownership cookie" do
    with_stubbed_image do
      get document_og_image_path(@document.slug), headers: { "User-Agent" => "Twitterbot/1.0" }
    end

    assert_response :success
    assert_equal "image/png", response.media_type
    assert response.body.b.start_with?("\x89PNG\r\n\x1A\n".b)
    assert_includes response.headers["Content-Disposition"], "inline"
    assert_includes response.headers["Cache-Control"], "public"
    assert response.headers["ETag"].present?
    assert response.headers["Set-Cookie"].blank?
    assert_not DocumentOgImagesController.allow_forgery_protection
    assert_nil @document.reload.seed_claimed_at
  end

  test "honors the image ETag" do
    with_stubbed_image do
      get document_og_image_path(@document.slug)
      etag = response.headers.fetch("ETag")

      get document_og_image_path(@document.slug), headers: { "If-None-Match" => etag }
    end

    assert_response :not_modified
    assert_empty response.body
  end

  test "returns 404 for an unknown document" do
    get document_og_image_path("missing")

    assert_response :not_found
  end

  private

  def with_stubbed_image
    original = DocumentOgImage.method(:call)
    DocumentOgImage.define_singleton_method(:call) { |_document| PNG_BYTES }
    yield
  ensure
    DocumentOgImage.define_singleton_method(:call, original)
  end
end
