require "net/http"

module Cursor
  class Client
    class Error < StandardError
      attr_reader :retryable

      def initialize(message, retryable:)
        super(message)
        @retryable = retryable
      end
    end

    BASE_URL = "https://api.cursor.com"

    def initialize(api_key: ENV["CURSOR_API_KEY"], base_url: BASE_URL, http: Net::HTTP)
      @api_key = api_key.to_s
      @base_url = base_url
      @http = http
    end

    def create_agent(payload, idempotency_key:)
      request(:post, "/v1/agents", payload:, idempotency_key:)
    end

    def run(agent_id, run_id)
      request(:get, "/v1/agents/#{escape(agent_id)}/runs/#{escape(run_id)}")
    end

    private

    def request(method, path, payload: nil, idempotency_key: nil)
      raise Error.new("Cursor automation is not configured.", retryable: false) if @api_key.blank?

      uri = URI.join(@base_url, path)
      request = method == :post ? Net::HTTP::Post.new(uri) : Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{@api_key}"
      request["Accept"] = "application/json"
      request["Content-Type"] = "application/json" if payload
      request["Idempotency-Key"] = idempotency_key if idempotency_key
      request.body = JSON.generate(payload) if payload

      response = @http.start(uri.host, uri.port, use_ssl: uri.scheme == "https",
                            open_timeout: 10, read_timeout: 30) do |http|
        http.request(request)
      end
      body = JSON.parse(response.body.presence || "{}")
      return body if response.code.to_i.between?(200, 299)

      message = body.dig("error", "message") || body["message"] || "Cursor returned HTTP #{response.code}."
      raise Error.new(message.to_s.truncate(500), retryable: response.code.to_i >= 500 || response.code.to_i == 429)
    rescue JSON::ParserError
      raise Error.new("Cursor returned an invalid response.", retryable: true)
    rescue Net::OpenTimeout, Net::ReadTimeout, SocketError, IOError, SystemCallError => error
      raise Error.new("Cursor could not be reached: #{error.class.name}.", retryable: true)
    end

    def escape(value)
      ERB::Util.url_encode(value.to_s)
    end
  end
end
