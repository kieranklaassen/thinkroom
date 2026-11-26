module AuthenticatesUser
  extend ActiveSupport::Concern

  private

  def complete_authentication(user, remember: false)
    destination = safe_return_to(session[:return_to])
    anonymous_token = owner_token

    # Documents and pins move together, before the token rotates below —
    # afterwards the guest token can no longer be matched.
    User.transaction do
      user.claim_documents!(anonymous_token)
      user.adopt_pins!(anonymous_token)
    end
    reset_session
    session[:user_id] = user.id
    # Ruby Native app users are always remembered (per rubynative.com/docs/
    # authentication) so the wrapped app never logs them out unexpectedly.
    # Covers password, signup, and OAuth sign-ins in one place.
    session[:remember_me] = true if remember || native_app? || native_oauth_flow?
    replace_owner_token!

    destination || root_path
  end

  # Native OAuth runs in a system-browser sheet whose UA carries no
  # "Ruby Native" marker, so native_app? is false on the callback request.
  # The gem's OAuthMiddleware tracks the native flow with a signed cookie
  # instead — its presence identifies a native-initiated sign-in. Presence
  # alone suffices: like the UA check, it only lets a client opt itself
  # into a longer session.
  def native_oauth_flow?
    cookies[RubyNative::OAuthMiddleware::COOKIE_NAME].present?
  end

  def remember_return_to
    session[:return_to] = safe_return_to(params[:return_to])
  end

  def render_auth_page(mode)
    # Marks the page as a form for the Ruby Native shell (nativeForm shared
    # prop), pairing with the NativeForm DOM signal the page renders — native
    # back navigation skips form pages after a successful sign-in.
    @native_form = true
    render inertia: "auth/show", props: {
      mode:,
      google_enabled: Rails.application.config.x.google_oauth_enabled,
      csrf_token: form_authenticity_token,
      return_to: safe_return_to(session[:return_to])
    }
  end

  def auth_path_with_return(path)
    destination = safe_return_to(session[:return_to])
    destination ? "#{path}?#{Rack::Utils.build_query(return_to: destination)}" : path
  end

  # A path on this site, returned exactly as given, or nil. The path part is
  # checked as text, decoded until nothing changes: a parsed URI's path leaves
  # out the host.
  def safe_return_to(value)
    return unless value.is_a?(String) && value.valid_encoding?
    return if value.match?(/[[:cntrl:]\\]/)

    URI.parse(value)
    path = value[/\A[^?#]*/].b
    return unless path.start_with?("/")

    nil while path.gsub!(/%\h\h/) { |escape| escape[1..].hex.chr }
    value unless path.match?(%r{//|[[:cntrl:]\\]})
  rescue URI::InvalidURIError
    nil
  end
end
