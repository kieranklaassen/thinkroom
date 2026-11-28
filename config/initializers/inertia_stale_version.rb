# frozen_string_literal: true

# A visit from older assets is answered with a location response, and the page
# reloads. inertia_rails (3.23) names the new version in that response, and the
# client then leaves the page as it is after an async visit. Background reloads
# and most writes here are async, so an open document would stop refreshing and
# drop the results of its writes. Without the header every visit reloads.
module InertiaStaleVersion
  private

  def force_refresh
    super.tap { |_status, headers, _body| headers.delete("X-Inertia-Version") }
  end
end

unless InertiaRails::Middleware::InertiaRailsRequest.private_method_defined?(:force_refresh)
  raise "inertia_stale_version: InertiaRails::Middleware::InertiaRailsRequest no longer defines #force_refresh. " \
        "Re-verify the stale version response against the installed inertia_rails version."
end
InertiaRails::Middleware::InertiaRailsRequest.prepend(InertiaStaleVersion)
