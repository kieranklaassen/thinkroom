require "test_helper"

class AgentUploadTest < ActionDispatch::IntegrationTest
  AGENT = { "X-Agent-Name" => "Scout" }.freeze
  PNG = Base64.decode64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ).freeze

  test "agent uploads an image and receives HTML-safe source metadata" do
    upload = uploaded_file("figure.png", "image/png", PNG)

    assert_difference -> { ActiveStorage::Blob.count }, 1 do
      post "/api/uploads", params: { file: upload }, headers: AGENT
    end

    assert_response :created
    body = response.parsed_body
    assert_match %r{\A/rails/active_storage/blobs/redirect/}, body["src"]
    assert_equal "#{request.base_url}#{body['src']}", body["url"]
    assert_equal "figure.png", body["filename"]
    assert_equal "image/png", body["content_type"]
    assert_equal PNG.bytesize, body["byte_size"]
    assert_includes body["html"], body["src"]
    assert_includes body["note"], "Use src exactly"

    get body["src"]
    assert_response :redirect
    follow_redirect!
    assert_response :success
    assert_equal PNG, response.body
  end

  test "upload requires agent identity with a copyable example" do
    assert_no_difference -> { ActiveStorage::Blob.count } do
      post "/api/uploads", params: { file: uploaded_file("figure.png", "image/png", PNG) }
    end

    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "X-Agent-Name"
    assert_includes response.parsed_body["example"], "/api/uploads"
    assert_includes response.parsed_body["example"], "-F"
  end

  test "upload requires a multipart file" do
    assert_no_difference -> { ActiveStorage::Blob.count } do
      post "/api/uploads", params: {}, headers: AGENT
    end

    assert_response :unprocessable_entity
    assert_equal "file is required.", response.parsed_body["error"]
    assert_includes response.parsed_body["example"], "file=@figure.png"
  end

  test "upload rejects non-image bytes even when declared as an image" do
    assert_no_difference -> { ActiveStorage::Blob.count } do
      post "/api/uploads",
           params: { file: uploaded_file("not-an-image.png", "image/png", "plain text") },
           headers: AGENT
    end

    assert_response :unprocessable_entity
    body = response.parsed_body
    assert_includes body["error"], "PNG, JPEG, GIF, or WebP"
    refute_equal "image/png", body["detected_content_type"]
  end

  test "upload rejects files larger than ten megabytes" do
    assert_no_difference -> { ActiveStorage::Blob.count } do
      post "/api/uploads",
           params: {
             file: uploaded_file("large.png", "image/png", PNG + ("\0" * Api::UploadsController::MAX_BYTES))
           },
           headers: AGENT
    end

    assert_response :content_too_large
    assert_equal Api::UploadsController::MAX_BYTES, response.parsed_body["max_bytes"]
  end

  private

  def uploaded_file(filename, content_type, content)
    file = Tempfile.new([ File.basename(filename, ".*"), File.extname(filename) ])
    file.binmode
    file.write(content)
    file.rewind
    Rack::Test::UploadedFile.new(file.path, content_type, original_filename: filename)
  end
end
