class ApplicationController < ActionController::Base
  include WriteRateLimited
  include AuthenticatesUser

  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  # Every browser carries a stable ownership identity, minted eagerly so two
  # near-simultaneous claims from one browser can never race to create
  # different tokens (cookie writes are last-write-wins). Permanent — survives
  # browser restarts, unlike the session. Signed — tamper-evident. Lax —
  # complements CSRF protection on the claim/delete POSTs.
  before_action :ensure_owner_token

  # Runs around the action so login (flag just set) upgrades to a persistent
  # cookie and logout (reset_session just cleared it) reverts to a
  # browser-session cookie. Re-applied every request: any session write
  # re-issues the cookie, and without expire_after that reissue would
  # silently downgrade a remembered session. Also slides the 30-day window.
  # around_action + ensure (not after_action) so rescue_from-handled requests
  # — which still commit the session — keep the expiry too.
  around_action :extend_remembered_session

  helper_method :current_user

  REMEMBER_ME_DURATION = 30.days

  private

  def extend_remembered_session
    yield
  ensure
    request.session_options[:expire_after] = REMEMBER_ME_DURATION if session[:remember_me]
  end

  def render_write_rate_limit
    render plain: "Too many requests. Try again later.", status: :too_many_requests
  end

  def ensure_owner_token
    return if cookies.signed[:owner_token].present?

    replace_owner_token!
  end

  def replace_owner_token!
    cookies.permanent.signed[:owner_token] = {
      value: SecureRandom.hex(16),
      same_site: :lax,
      httponly: true
    }
  end

  # The browser's ownership identity. Never rendered into props or payloads.
  def owner_token
    cookies.signed[:owner_token]
  end

  def current_user
    return @current_user if defined?(@current_user)

    @current_user = User.find_by(id: session[:user_id])
  end
end
