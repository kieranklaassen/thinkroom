require "test_helper"

class WriteRateLimitTest < ActionDispatch::IntegrationTest
  setup do
    WriteRateLimited::STORE.clear
  end

  test "agent document creation returns a JSON 429 after the burst limit" do
    headers = { "X-Agent-Name" => "Scout", "REMOTE_ADDR" => "192.0.2.241" }

    WriteRateLimited::DOCUMENT_CREATION_BURST_LIMIT.times do
      post "/api/docs", params: { format: "invalid" }, headers:, as: :json
      assert_response :unprocessable_entity
    end

    post "/api/docs", params: { format: "invalid" }, headers:, as: :json

    assert_response :too_many_requests
    assert_includes response.parsed_body.fetch("error"), "rate limit"
  end

  test "browser contributions return a 429 after the burst limit" do
    document = Document.create!(title: "Rate limited")
    headers = { "User-Agent" => "Mozilla/5.0", "REMOTE_ADDR" => "192.0.2.242" }

    WriteRateLimited::CONTRIBUTION_BURST_LIMIT.times do
      post document_comments_path(document.slug), params: { body: "" }, headers: headers
      assert_response :redirect
    end

    post document_comments_path(document.slug), params: { body: "" }, headers: headers

    assert_response :too_many_requests
    assert_equal "Too many requests. Try again later.", response.body
  end
end
