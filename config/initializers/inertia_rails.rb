# frozen_string_literal: true

InertiaRails.configure do |config|
  # NOTE: InertiaController overrides this with a chdir-safe wrapper —
  # ViteRuby.digest chdirs and concurrent requests racing it raise.
  config.version = -> { ViteRuby.digest }
  config.encrypt_history = true
  config.always_include_errors_hash = true
  config.use_script_element_for_initial_page = true
  config.use_data_inertia_head_attribute = true

  # SSR. Globally OFF — DocumentsController#show opts in via inertia_config so
  # only the document page is server-rendered (landing/auth stay CSR). In dev
  # the Vite dev server serves SSR through inertia_rails' auto-detected
  # /__inertia_ssr endpoint, so ssr_url stays nil. Production points ssr_url at
  # the Node SSR process and ships an ssr_bundle (deferred — U6).
  #
  # Surface SSR render errors loudly in dev and degrade to CSR in production:
  # a render failure must never 500 the production-critical doc page.
  # on_ssr_error logs every failure so silent CSR fallbacks are visible.
  config.ssr_raise_on_error = Rails.env.development?
  config.on_ssr_error = ->(error, page) do
    Rails.logger.error(
      "[inertia-ssr] #{page&.dig(:component) || page&.dig('component')} render failed: " \
      "#{error.class}: #{error.message}"
    )
  end

  # Bundle detection gates whether SSR is even attempted. In dev the Vite dev
  # server serves SSR (this check is bypassed when the dev server is running).
  # In production SSR proceeds only once the SSR bundle exists at this path —
  # so if the production SSR build is ever absent, the doc page degrades
  # cleanly to CSR instead of hammering a missing SSR server on every request.
  # `vite build --ssr` (vite-plugin-ruby) emits the entry chunk as ssr.js
  # under its ssrOutputDir (public/vite-ssr); the Docker build produces it and
  # the runtime image runs it as the Node SSR process (see Dockerfile).
  config.ssr_bundle = Rails.root.join("public/vite-ssr/ssr.js").to_s

  # In production point Inertia at the Node SSR process the container starts
  # alongside Rails (backgrounded in bin/docker-entrypoint). Default matches
  # @inertiajs/react/server's createServer port (13714) on localhost; override
  # with INERTIA_SSR_URL if the SSR process is moved. In dev/test this stays
  # nil so inertia-rails auto-detects the Vite dev server's /__inertia_ssr
  # endpoint and no separate process is needed.
  config.ssr_url = ENV.fetch("INERTIA_SSR_URL", "http://localhost:13714") if Rails.env.production?
end
