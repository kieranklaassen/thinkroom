# Shared assertions for inspecting the session cookie re-issued by the
# latest response — used to verify remember-me persistence behavior.
module SessionCookieAssertions
  private

  # The session cookie set by the latest response, or nil if not re-issued.
  def session_cookie_header
    key = Rails.application.config.session_options.fetch(:key)
    header = Array(response.headers["Set-Cookie"]).flat_map { |value| value.split("\n") }
    header.find { |value| value.start_with?("#{key}=") }
  end

  def session_cookie_reissued? = session_cookie_header.present?

  # Expiry of the re-issued session cookie; nil for a browser-session cookie.
  # Callers asserting nil should pair with session_cookie_reissued? so a
  # missing cookie can't false-pass as "no expiry".
  def session_cookie_expiry
    expires = session_cookie_header&.[](/expires=([^;]+)/i, 1)
    expires && Time.zone.parse(expires)
  end
end
