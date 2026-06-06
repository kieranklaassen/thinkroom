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
  # The viewer's chosen display name lives in the session; no name set means
  # guest mode (the client falls back to its random localStorage identity).
  inertia_share viewer: -> { { name: session[:display_name], guest: session[:display_name].blank? } }

  private

  # Session name wins over client-posted names on every attribution write —
  # a stale tab can't sign your old guest name once you've introduced
  # yourself. Guests keep the client-posted value, then the fallback.
  # Non-string params (name[x]=1 produces ActionController::Parameters) are
  # treated as absent rather than stringified into garbage attribution.
  def preferred_name(raw, fallback:)
    session[:display_name].presence || (raw.presence if raw.is_a?(String)) || fallback
  end
end
