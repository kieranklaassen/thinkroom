# frozen_string_literal: true

# A server render that fails must never 500 the document page. inertia_rails
# (3.23) handles only the errors it raises itself, so a reply it cannot read
# (a success that is not JSON, an error body that is not an object) would reach
# the browser as a 500. Here every other error takes the same path: on_ssr_error,
# then the browser renders, or a raise where ssr_raise_on_error is set.
module InertiaSSRFallback
  def render
    super
  rescue InertiaRails::SSRError
    raise
  rescue StandardError => e
    handle_error(InertiaRails::SSRError.new(e.message))
  end
end

unless InertiaRails::SSRRenderer.method_defined?(:render) &&
       InertiaRails::SSRRenderer.private_method_defined?(:handle_error)
  raise "inertia_ssr_fallback: InertiaRails::SSRRenderer no longer defines #render and #handle_error. " \
        "Re-verify the fallback against the installed inertia_rails version."
end
InertiaRails::SSRRenderer.prepend(InertiaSSRFallback)
