# WebmcpOriginTrial is autoloaded app code, so it is read once the autoloader
# is ready rather than at initializer load time.
Rails.application.config.after_initialize do
  Rails.application.config.x.webmcp_origin_trial_tokens = WebmcpOriginTrial.tokens_from(ENV)
end
