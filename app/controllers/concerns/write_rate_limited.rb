module WriteRateLimited
  extend ActiveSupport::Concern

  STORE = Rails.env.test? ? ActiveSupport::Cache::MemoryStore.new : Rails.cache
  DOCUMENT_CREATION_BURST_LIMIT = 20
  DOCUMENT_CREATION_DAILY_LIMIT = 100
  CONTRIBUTION_BURST_LIMIT = 60
  CONTRIBUTION_DAILY_LIMIT = 500

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
  end
end
