require "test_helper"
require "socket"

# A server render that fails, whatever the SSR server sends back, leaves the
# document page to the browser.
class InertiaSsrFallbackTest < ActionDispatch::IntegrationTest
  BROWSER = { "User-Agent" => "Mozilla/5.0 (Macintosh) Chrome/126 Safari/537.36" }.freeze
  MARK = "text-from-the-document"

  setup do
    @document = Document.create!(title: "Doc", seed_markdown: "# Hello", seed_state: "done")
    @errors = []
    @original = DocumentsController._inertia_configuration
  end

  teardown { use_configuration(@original) }

  {
    "a success that is not JSON" => [ "200 OK", "<html>#{MARK}</html>", /JSON::ParserError/ ],
    "an empty success" => [ "200 OK", "", /JSON::ParserError/ ],
    "a success cut short" => [ "200 OK", %({"head":[],"body":"#{MARK}), /JSON::ParserError/ ],
    "a success without a page" => [ "200 OK", "{}", /unreadable reply/ ],
    "a success that is a list" => [ "200 OK", %(["#{MARK}"]), /unreadable reply/ ],
    "a success that is text" => [ "200 OK", MARK.to_json, /unreadable reply/ ],
    "a success whose head is not a list" => [ "200 OK", { head: MARK, body: MARK }.to_json, /unreadable reply/ ],
    "a success whose body is not text" => [ "200 OK", { head: [], body: [ MARK ] }.to_json, /unreadable reply/ ],
    "an error that is not an object" => [ "500 Internal Server Error", %(["#{MARK}"]), /TypeError/ ],
    "an error that is not JSON" => [ "502 Bad Gateway", MARK, /render error/ ],
    "a render error" => [ "500 Internal Server Error", { error: MARK, type: "render" }.to_json, /render failed: .*render\z/ ]
  }.each do |shape, (status, body, named)|
    test "#{shape} falls back to the browser" do
      with_ssr_reply(status, body) { assert_client_rendered(named) }
    end
  end

  test "a refused connection falls back to the browser" do
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    server.close
    configure_ssr(port)
    assert_client_rendered(/Errno::ECONNREFUSED/)
  end

  test "a server that does not answer falls back to the browser" do
    server = TCPServer.new("127.0.0.1", 0)
    configure_ssr(server.addr[1])
    assert_client_rendered(/Net::ReadTimeout/)
  ensure
    server&.close
  end

  test "an unreadable reply raises where errors are raised" do
    with_ssr_reply("200 OK", "not JSON", ssr_raise_on_error: true) do
      renderer = InertiaRails::SSRRenderer.new(DocumentsController._inertia_configuration,
                                               page: { component: "documents/show", props: {} })
      assert_raises(InertiaRails::SSRError) { renderer.render }
    end
    assert_equal 1, @errors.size
  end

  test "a readable reply is served" do
    with_ssr_reply("200 OK", { head: [ "<meta name=from-ssr>" ], body: "<div id=app>from the server</div>" }.to_json) do
      get document_mode_path(@document.slug, "edit"), headers: BROWSER
    end
    assert_response :success
    assert_select "#app", "from the server"
    assert_select "head meta[name=from-ssr]"
    assert_empty @errors
  end

  private

  # The app's own configuration, pointed at a server the test runs. A
  # controller keeps its configuration from its first request on.
  def configure_ssr(port, **settings)
    report = @original.on_ssr_error
    use_configuration(@original.merge(InertiaRails::Configuration.new(
      ssr_url: "http://127.0.0.1:#{port}", ssr_bundle: nil, ssr_raise_on_error: false,
      on_ssr_error: ->(error, page) { @errors << error; report.call(error, page) }, **settings
    )))
  end

  def use_configuration(configuration)
    DocumentsController.instance_variable_set(:@_inertia_configuration, configuration)
  end

  def assert_client_rendered(named)
    log = StringIO.new
    logger = ActiveSupport::Logger.new(log)
    Rails.logger.broadcast_to(logger)
    begin
      get document_mode_path(@document.slug, "edit"), headers: BROWSER
    ensure
      Rails.logger.stop_broadcasting_to(logger)
    end

    assert_response :success
    assert_select "script[data-page=app]", 1
    assert_select "div#app", ""
    assert_equal 1, @errors.size
    failures = log.string.lines(chomp: true).grep(/\[inertia-ssr\]/)
    assert_equal 1, failures.size
    assert_match named, failures.first
    assert_not_includes log.string, MARK
  end

  def with_ssr_reply(status, body, **settings)
    server = TCPServer.new("127.0.0.1", 0)
    configure_ssr(server.addr[1], **settings)
    thread = Thread.new do
      client = server.accept
      length = 0
      while (line = client.gets) && line != "\r\n"
        length = Integer(line[/\d+/]) if line.match?(/\Acontent-length:/i)
      end
      client.read(length)
      client.write("HTTP/1.1 #{status}\r\nContent-Type: application/json\r\n" \
                   "Content-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}")
      client.close
    end
    yield
    assert thread.join(5), "the SSR server was not asked"
  ensure
    thread&.kill
    server&.close
  end
end
