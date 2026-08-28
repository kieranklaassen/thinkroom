# Reads the Chrome origin-trial tokens for WebMCP out of the environment.
#
# Origin-trial tokens are public by design: Google signs them and binds them
# to one origin, so exposure in page markup is expected. Every production
# host needs its own token, and one deployment serves several hosts, so the
# variable holds one token per registered origin (whitespace- or
# comma-separated); the layout emits one <meta> per token and Chrome ignores
# the ones bound to another origin. The only thing worth guarding is the
# markup itself: tokens are base64-ish, so anything outside that alphabet (a
# mangled or tampered value) is dropped rather than interpolated into a <meta>
# attribute.
module WebmcpOriginTrial
  ENV_KEY = "WEBMCP_ORIGIN_TRIAL_TOKEN"
  TOKEN_FORMAT = /\A[A-Za-z0-9+\/=]+\z/

  def self.tokens_from(env)
    env[ENV_KEY].to_s.split(/[\s,]+/).select { |token| TOKEN_FORMAT.match?(token) }
  end
end
