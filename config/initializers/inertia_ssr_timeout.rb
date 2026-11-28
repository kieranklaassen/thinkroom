# frozen_string_literal: true

# inertia_rails renders SSR by POSTing the page JSON to the Node SSR process via
# Net::HTTP. A *hung* (not crashed) SSR process pins a Puma thread until that
# call times out, so a handful of hung renders can exhaust the thread pool and
# stall the whole app. The gem (3.23) waits ssr_timeout, 10 seconds by default;
# here the SSR HTTP call is bounded to a shorter timeout, which replaces the
# gem's open and read timeouts. The gem wraps a timeout into an SSRError →
# on_ssr_error logging → CSR fallback (in production, where ssr_raise_on_error
# is false).
#
# Implementation: rather than re-implement the gem's #request body (which would
# drift if the gem changes its error handling), we leave the gem's request flow
# untouched and only inject open_timeout/read_timeout into the Net::HTTP
# connection it opens, scoped to the SSR call via a thread-local flag. This
# keeps coupling to gem internals minimal — we depend only on the gem opening
# its connection through Net::HTTP.start inside #request.
#
# Override INERTIA_SSR_TIMEOUT to tune (seconds).
InertiaRails::SSRRenderer.class_eval do
  # Loud boot-time guard: if a future gem version removes #request, the patch is
  # silently dead and a hung SSR process is back to the gem's timeout. Fail at boot instead.
  unless private_method_defined?(:request)
    raise "inertia_ssr_timeout: InertiaRails::SSRRenderer no longer defines #request " \
          "(gem internals changed). Re-verify the SSR HTTP timeout patch against the " \
          "installed inertia_rails version before removing this guard."
  end
end

module InertiaSSRTimeout
  TIMEOUT_SECONDS = Float(ENV.fetch("INERTIA_SSR_TIMEOUT", "2"))

  # Marks the SSR HTTP call so the Net::HTTP patch below only bounds inertia's
  # SSR connection, never every Net::HTTP.start in the app.
  def request
    Thread.current[:inertia_ssr_http_active] = true
    super
  ensure
    Thread.current[:inertia_ssr_http_active] = nil
  end

  # Injects the short timeouts into the connection inertia opens. Net::HTTP.start
  # accepts open_timeout/read_timeout as opts; we merge them in only for the SSR
  # call. Guarded so it fails loudly at boot if Net::HTTP.start's arity changes.
  module NetHTTPPatch
    def start(address, *args, &block)
      if Thread.current[:inertia_ssr_http_active]
        opts = args.last.is_a?(Hash) ? args.pop.dup : {}
        opts[:open_timeout] = InertiaSSRTimeout::TIMEOUT_SECONDS
        opts[:read_timeout] = InertiaSSRTimeout::TIMEOUT_SECONDS
        args.push(opts)
      end
      super(address, *args, &block)
    end
  end
end

InertiaRails::SSRRenderer.prepend(InertiaSSRTimeout)
Net::HTTP.singleton_class.prepend(InertiaSSRTimeout::NetHTTPPatch)
