require "test_helper"

class AgentUploadTest < ActionDispatch::IntegrationTest
  PNG = Base64.decode64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ).freeze

  setup do
    octet = (Zlib.crc32(name) % 200) + 20
    @agent = { "X-Agent-Name" => "Scout", "REMOTE_ADDR" => "192.0.2.#{octet}" }
  end

  test "agent uploads a decoded image and receives source-ready metadata" do
    assert_difference -> { ActiveStorage::Blob.count } => 1,
                      -> { DocumentAsset.count } => 1 do
      post "/api/uploads",
           params: { file: uploaded_file("figure.png", "image/png", PNG) },
           headers: @agent
    end

    assert_response :created
    body = response.parsed_body
    assert_match %r{\A/rails/active_storage/blobs/redirect/}, body["src"]
    assert_equal "#{request.base_url}#{body['src']}", body["url"]
    assert_equal "figure.png", body["filename"]
    assert_equal "image/png", body["content_type"]
    assert_operator body["byte_size"], :>, 0
    assert_equal 1, body["width"]
    assert_equal 1, body["height"]
    assert body["expires_at"].present?
    assert_includes body["html"], body["src"]
    assert_includes body["note"], "within one hour"

    get body["src"]
    assert_response :redirect
    follow_redirect!
    assert_response :success
    assert response.body.start_with?("\x89PNG".b)
  end

  test "uploaded src survives HTML creation and becomes document-owned" do
    post "/api/uploads",
         params: { file: uploaded_file("field-map.png", "image/png", PNG) },
         headers: @agent
    src = response.parsed_body.fetch("src")
    asset = DocumentAsset.last

    html = %(<h1>Field report</h1><p><img src="#{src}" alt="Activity map"></p>)
    post "/api/docs",
         params: { title: "Field report", format: "html", content: html },
         headers: @agent,
         as: :json

    assert_response :created
    body = response.parsed_body
    assert_equal html, body["content"]
    refute body["normalized"]
    assert_equal body["slug"], asset.reload.document.slug
    assert_operator asset.expires_at, :>, 90.years.from_now
  end

  test "document deletion purges its claimed image" do
    post "/api/uploads",
         params: { file: uploaded_file("figure.png", "image/png", PNG) },
         headers: @agent
    asset = DocumentAsset.last
    blob_id = asset.file.blob.id
    document = Document.create!(title: "Owned image", content_format: "html", seed_content: "<p>Image</p>")
    asset.update!(document:)

    document.destroy!

    refute DocumentAsset.exists?(asset.id)
    refute ActiveStorage::Blob.exists?(blob_id)
  end

  test "HTML suggestion claims an uploaded image for the target document" do
    document = Document.create!(
      title: "Suggestions",
      content_format: "html",
      seed_content: "<p>Current</p>"
    )
    post "/api/uploads",
         params: { file: uploaded_file("proposal.png", "image/png", PNG) },
         headers: @agent
    src = response.parsed_body.fetch("src")
    asset = DocumentAsset.last

    post "/api/docs/#{document.slug}/suggestions",
         params: { body: %(<p>Proposed <img src="#{src}" alt="Proposal"></p>) },
         headers: @agent,
         as: :json

    assert_response :created
    assert_equal document, asset.reload.document
    assert_includes document.suggestions.last.body, src
  end

  test "upload response escapes a hostile filename in ready HTML" do
    post "/api/uploads",
         params: { file: uploaded_file(%(plot" onerror="alert(1).png), "image/png", PNG) },
         headers: @agent

    assert_response :created
    body = response.parsed_body
    refute_includes body["html"], '" onerror="'
    assert_includes body["html"], "&quot;"
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
      post "/api/uploads", params: {}, headers: @agent
    end

    assert_response :unprocessable_entity
    assert_equal "file is required.", response.parsed_body["error"]
    assert_includes response.parsed_body["example"], "file=@figure.png"
  end

  test "upload rejects non-image bytes even when declared as an image" do
    assert_no_difference -> { ActiveStorage::Blob.count } do
      post "/api/uploads",
           params: { file: uploaded_file("not-an-image.png", "image/png", "plain text") },
           headers: @agent
    end

    assert_response :unprocessable_entity
    body = response.parsed_body
    assert_includes body["error"], "PNG, JPEG, or WebP"
    refute_equal "image/png", body["detected_content_type"]
  end

  test "upload rejects malformed image data after MIME detection" do
    assert_no_difference -> { ActiveStorage::Blob.count } do
      post "/api/uploads",
           params: { file: uploaded_file("broken.png", "image/png", PNG.first(32)) },
           headers: @agent
    end

    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "could not be decoded"
  end

  test "upload rejects files larger than the policy limit" do
    assert_no_difference -> { ActiveStorage::Blob.count } do
      post "/api/uploads",
           params: {
             file: uploaded_file(
               "large.png",
               "image/png",
               PNG + ("\0" * ImageUploadPolicy::MAX_INPUT_BYTES)
             )
           },
           headers: @agent
    end

    assert_response :content_too_large
    assert_equal ImageUploadPolicy::MAX_INPUT_BYTES, response.parsed_body["max_bytes"]
  end

  test "content length guard rejects oversized requests before multipart parsing" do
    post "/api/uploads",
         params: {},
         headers: @agent.merge(
           "CONTENT_LENGTH" => (ImageUploadPolicy::MAX_REQUEST_BYTES + 1).to_s
         )

    assert_response :content_too_large
    assert_equal "request body is too large.", response.parsed_body["error"]
  end

  test "upload endpoint throttles repeated requests by IP" do
    headers = @agent.merge("REMOTE_ADDR" => "198.51.100.211")
    20.times do
      post "/api/uploads",
           params: { file: uploaded_file("pixel.png", "image/png", PNG) },
           headers: headers
      assert_response :created
    end

    post "/api/uploads",
         params: { file: uploaded_file("pixel.png", "image/png", PNG) },
         headers: headers

    assert_response :too_many_requests
    assert_includes response.parsed_body["error"], "rate limit"
  ensure
    DocumentAsset.where(uploader_name: "Scout").find_each(&:destroy!)
  end

  test "storage failure removes the temporary asset and blob row" do
    processed = ImageUploadPolicy.process(uploaded_file("figure.png", "image/png", PNG))
    blob = ActiveStorage::Blob.create_after_unfurling!(
      io: processed.io,
      filename: processed.filename,
      content_type: processed.content_type,
      identify: false
    )
    blob.define_singleton_method(:upload_without_unfurling) do |_io|
      raise ActiveStorage::IntegrityError
    end

    original_create = ActiveStorage::Blob.method(:create_after_unfurling!)
    ActiveStorage::Blob.define_singleton_method(:create_after_unfurling!) { |**| blob }
    begin
      assert_raises(ActiveStorage::IntegrityError) do
        DocumentAsset.store!(processed:, uploader_name: "Scout")
      end
    ensure
      ActiveStorage::Blob.define_singleton_method(:create_after_unfurling!) do |**arguments|
        original_create.call(**arguments)
      end
    end

    refute ActiveStorage::Blob.exists?(blob.id)
    assert_equal 0, DocumentAsset.count
  end

  private

  def uploaded_file(filename, content_type, content)
    file = Tempfile.new([ "upload", File.extname(filename) ])
    file.binmode
    file.write(content)
    file.rewind
    Rack::Test::UploadedFile.new(file.path, content_type, original_filename: filename)
  end
end
