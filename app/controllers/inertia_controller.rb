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
  #   inertia_share user: -> { Current.user&.as_json(only: [:id, :name, :email]) }
end
