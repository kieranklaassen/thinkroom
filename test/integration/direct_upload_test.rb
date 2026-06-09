require "test_helper"

class DirectUploadTest < ActionDispatch::IntegrationTest
  test "generic Active Storage direct uploads are disabled" do
    post rails_direct_uploads_path, params: {
      blob: {
        filename: "pixel.png",
        byte_size: 68,
        checksum: "unused",
        content_type: "image/png"
      }
    }, as: :json

    assert_response :not_found
    assert_includes response.parsed_body["error"], "/api/uploads"
    assert_equal 0, ActiveStorage::Blob.count
  end
end
