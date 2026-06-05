require "test_helper"

class DirectUploadTest < ActionDispatch::IntegrationTest
  # 1x1 transparent PNG
  PNG = Base64.decode64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ).freeze

  test "direct upload flow issues a blob and serves the uploaded file" do
    checksum = Digest::MD5.base64digest(PNG)

    post rails_direct_uploads_path, params: {
      blob: {
        filename: "pixel.png",
        byte_size: PNG.bytesize,
        checksum: checksum,
        content_type: "image/png"
      }
    }, as: :json

    assert_response :success
    body = response.parsed_body
    assert body["signed_id"].present?
    upload = body["direct_upload"]
    assert upload["url"].present?

    # Perform the upload the way @rails/activestorage does
    put upload["url"], params: PNG, headers: upload["headers"]
    assert_response :no_content

    # The blob redirect URL (what lands in the image node src) serves the file
    get rails_service_blob_path(body["signed_id"], "pixel.png")
    assert_response :redirect

    follow_redirect!
    assert_response :success
    assert_equal PNG, response.body
  end
end
