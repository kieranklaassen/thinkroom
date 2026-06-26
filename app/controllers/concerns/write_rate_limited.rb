module WriteRateLimited
  extend ActiveSupport::Concern

  STORE = Rails.env.test? ? ActiveSupport::Cache::MemoryStore.new : Rails.cache
  DOCUMENT_CREATION_BURST_LIMIT = 20
  DOCUMENT_CREATION_DAILY_LIMIT = 100
  CONTRIBUTION_BURST_LIMIT = 60
  CONTRIBUTION_DAILY_LIMIT = 500
  AUTHENTICATION_BURST_LIMIT = 10
  CLI_DEVICE_BURST_LIMIT = 10
  CLI_POLL_BURST_LIMIT = 1_200

  class_methods do
    def rate_limit_document_creation
      rate_limit to: DOCUMENT_CREATION_BURST_LIMIT, within: 10.minutes, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "document-creation-burst",
                 only: :create
      rate_limit to: DOCUMENT_CREATION_DAILY_LIMIT, within: 1.day, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "document-creation-daily",
                 only: :create
    end

    def rate_limit_contributions
      rate_limit to: CONTRIBUTION_BURST_LIMIT, within: 10.minutes, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "contribution-burst",
                 only: :create
      rate_limit to: CONTRIBUTION_DAILY_LIMIT, within: 1.day, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "contribution-daily",
                 only: :create
    end

    # Updating a seed-stage document is a contribution-class write (a revision),
    # not a new-document event — share the contribution limits, scoped to the
    # update action.
    def rate_limit_document_update
      rate_limit to: CONTRIBUTION_BURST_LIMIT, within: 10.minutes, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "document-update-burst",
                 only: :update
      rate_limit to: CONTRIBUTION_DAILY_LIMIT, within: 1.day, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "document-update-daily",
                 only: :update
    end

    def rate_limit_authentication
      rate_limit to: AUTHENTICATION_BURST_LIMIT, within: 10.minutes, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "authentication-burst",
                 only: :create
    end

    def rate_limit_cli_device_authorization
      rate_limit to: CLI_DEVICE_BURST_LIMIT, within: 10.minutes, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "cli-device-authorization",
                 only: :create
    end

    def rate_limit_cli_token_polling
      rate_limit to: CLI_POLL_BURST_LIMIT, within: 10.minutes, by: -> { request.remote_ip },
                 with: :render_write_rate_limit, store: STORE, name: "cli-token-polling",
                 only: :token
    end
  end
end
