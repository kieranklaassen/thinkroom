require "test_helper"

class CursorClientTest < ActiveSupport::TestCase
  Response = Data.define(:code, :body)

  class FakeHttp
    class << self
      attr_accessor :last_request
    end

    def self.start(_host, _port, **)
      yield self
    end

    def self.request(request)
      self.last_request = request
      Response.new(code: "201", body: '{"agent":{"id":"bc-1"},"run":{"id":"run-1"}}')
    end
  end

  test "creates a v1 agent with bearer auth and an idempotency key" do
    client = Cursor::Client.new(api_key: "cursor-test-key", http: FakeHttp)
    response = client.create_agent(
      { prompt: { text: "Analyze feedback" }, repos: [ { url: "https://example.com/repo" } ] },
      idempotency_key: "attempt-1"
    )

    assert_equal "bc-1", response.dig("agent", "id")
    assert_equal "Bearer cursor-test-key", FakeHttp.last_request["Authorization"]
    assert_equal "attempt-1", FakeHttp.last_request["Idempotency-Key"]
    assert_equal "/v1/agents", FakeHttp.last_request.uri.path
    assert_equal "Analyze feedback", JSON.parse(FakeHttp.last_request.body).dig("prompt", "text")
  end

  test "refuses to call Cursor without a configured API key" do
    error = assert_raises(Cursor::Client::Error) do
      Cursor::Client.new(api_key: "", http: FakeHttp).create_agent({}, idempotency_key: "attempt-1")
    end

    assert_not error.retryable
    assert_includes error.message, "not configured"
  end
end
