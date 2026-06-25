# frozen_string_literal: true

class InertiaController < ApplicationController
  # ViteRuby.digest chdirs into the project root — a process-global move.
  # Concurrent Inertia requests (two clients reloading off one broadcast,
  # or one client's simultaneous partial reloads) raced that chdir and 500'd
  # with "conflicting chdir during another chdir block", silently dropping
  # live updates. Serialize it, and reuse the last good digest if another
  # chdir (vite autoBuild) is mid-flight.
  DIGEST_LOCK = Mutex.new

  def self.safe_vite_digest
    DIGEST_LOCK.synchronize { @last_digest = ViteRuby.digest }
  rescue RuntimeError
    @last_digest
  end

  inertia_config version: -> { InertiaController.safe_vite_digest }

  # Share data with all Inertia responses
  # see https://inertia-rails.dev/guide/shared-data
  # Account identity wins over the optional guest display name. Only the
  # small public account shape reaches the client.
  #
  # The guest identity (random name + presence color) lives only in the
  # browser, so it rides a plain `pruf_guest` cookie (written client-side,
  # see app/frontend/lib/cookies.ts) so SSR can render the real guest name +
  # color at first paint — no Anonymous→name flash post-hydration. Signed-in
  # users ignore it (their account name wins).
  inertia_share viewer: -> {
    account = current_user&.slice(:id, :name, :email)
    name = current_user&.name || session[:display_name]
    guest = guest_identity_cookie
    {
      name:,
      guest: current_user.nil? && name.blank?,
      account:,
      guest_name: (guest["name"] if current_user.nil?),
      guest_color: (guest["color"] if current_user.nil?)
    }
  }

  private

  # Parse the client-written `pruf_guest` JSON cookie ({name, color}). It's
  # presentation-only (a random label + a paper-friendly color), so a plain
  # cookie is fine — no signing. Malformed/oversized values degrade to {}.
  def guest_identity_cookie
    raw = cookies[:pruf_guest]
    return {} if raw.blank? || raw.bytesize > 512

    parsed = JSON.parse(raw)
    return {} unless parsed.is_a?(Hash)

    {
      "name" => (parsed["name"] if parsed["name"].is_a?(String) && parsed["name"].present?),
      "color" => (parsed["color"] if parsed["color"].is_a?(String) && parsed["color"].match?(/\A#[0-9a-fA-F]{3,8}\z/))
    }.compact
  rescue JSON::ParserError
    {}
  end

  # Session name wins over client-posted names on every attribution write —
  # a stale tab can't sign your old guest name once you've introduced
  # yourself. Guests keep the client-posted value, then the fallback.
  # Non-string params (name[x]=1 produces ActionController::Parameters) are
  # treated as absent rather than stringified into garbage attribution.
  def preferred_name(raw, fallback:)
    current_user&.name || session[:display_name].presence ||
      (raw.presence if raw.is_a?(String)) || fallback
  end
end
