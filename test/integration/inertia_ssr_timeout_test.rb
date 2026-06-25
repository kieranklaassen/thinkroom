require "test_helper"
require "socket"

# Guards config/initializers/inertia_ssr_timeout.rb: a *hung* SSR Node process
# (TCP connect succeeds, read blocks forever) must fail fast via a short HTTP
# timeout rather than pinning a Puma thread for Ruby's ~60s default. The gem
# wraps any SSR error into an SSRError → CSR fallback, so a hung process now
# degrades to CSR quickly instead of starving the thread pool.
class InertiaSsrTimeoutTest < ActiveSupport::TestCase
  test "the timeout patch is wired into the renderer and Net::HTTP" do
    assert_includes InertiaRails::SSRRenderer.ancestors, InertiaSSRTimeout,
      "SSRRenderer#request must be wrapped to flag the SSR HTTP call"
    assert_includes Net::HTTP.singleton_class.ancestors, InertiaSSRTimeout::NetHTTPPatch,
      "Net::HTTP.start must be patched to inject the SSR timeout"
    assert_operator InertiaSSRTimeout::TIMEOUT_SECONDS, :<=, 5,
      "SSR timeout must stay short so a hung render fails fast"
  end

  test "a hung SSR server fails fast instead of blocking ~60s" do
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    # Accept connections but never write a response — connect succeeds, the
    # read blocks. This is the hung-process case the timeout must bound.
    accept_thread = Thread.new do
      loop do
        server.accept
      rescue StandardError
        break
      end
    end

    config = InertiaRails::Configuration.default
    config.ssr_url = "http://127.0.0.1:#{port}"
    config.ssr_bundle = nil          # skip bundle check → actually attempt SSR
    config.ssr_raise_on_error = true # surface the timeout so the test can see it

    page = { component: "documents/show", props: {}, url: "/", version: "x" }
    renderer = InertiaRails::SSRRenderer.new(config, page: page)

    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    error = assert_raises(InertiaRails::SSRError) { renderer.render }
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started

    assert_match(/timeout/i, error.message, "the failure must be a timeout")
    # Comfortably under Ruby's ~60s default; the configured timeout is ~2s.
    assert_operator elapsed, :<, 10, "a hung SSR render must fail fast (got #{elapsed.round(2)}s)"
  ensure
    server&.close
    accept_thread&.kill
  end
end
