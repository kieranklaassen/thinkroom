google_client_id = ENV["GOOGLE_CLIENT_ID"].presence
google_client_secret = ENV["GOOGLE_CLIENT_SECRET"].presence
google_enabled = google_client_id.present? && google_client_secret.present?
google_strategy_configured = google_enabled || Rails.env.test?

Rails.application.config.x.google_oauth_enabled = google_enabled
Rails.application.config.x.google_oauth_strategy_configured = google_strategy_configured

if google_strategy_configured
  Rails.application.config.middleware.use OmniAuth::Builder do
    provider :google_oauth2,
             google_client_id || "test-google-client",
             google_client_secret || "test-google-secret",
             scope: "email,profile",
             access_type: "online",
             prompt: "select_account"
  end
end

OmniAuth.config.allowed_request_methods = %i[post]
OmniAuth.config.silence_get_warning = true
