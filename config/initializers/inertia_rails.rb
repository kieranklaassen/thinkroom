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
  # so until the production SSR build is wired (deploy unit, deferred), the doc
  # page degrades cleanly to CSR instead of hammering a missing SSR server on
  # every request. The plugin's SSR build emits the entry basename here.
  config.ssr_bundle = Rails.root.join("public/vite-ssr/inertia.js").to_s
end
