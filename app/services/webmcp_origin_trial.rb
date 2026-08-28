# Reads the Chrome origin-trial token for WebMCP out of the environment.
#
# Origin-trial tokens are public by design: Google signs them and binds them
# to an origin, so exposure in page markup is expected. The only thing worth
# guarding is the markup itself. Tokens are base64-ish, so anything outside
# that alphabet (a mangled or tampered env var) is dropped rather than
# interpolated into a <meta> attribute.
module WebmcpOriginTrial
  ENV_KEY = "WEBMCP_ORIGIN_TRIAL_TOKEN"
  TOKEN_FORMAT = /\A[A-Za-z0-9+\/=]+\z/

  def self.token_from(env)
    value = env[ENV_KEY].to_s
    value if TOKEN_FORMAT.match?(value)
  end
end
