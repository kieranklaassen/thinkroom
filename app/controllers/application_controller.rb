class ApplicationController < ActionController::Base
  include WriteRateLimited

  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  # Every browser carries a stable ownership identity, minted eagerly so two
  # near-simultaneous claims from one browser can never race to create
  # different tokens (cookie writes are last-write-wins). Permanent — survives
  # browser restarts, unlike the session. Signed — tamper-evident. Lax —
  # complements CSRF protection on the claim/delete POSTs.
  before_action :ensure_owner_token

  private

  def render_write_rate_limit
    render plain: "Too many requests. Try again later.", status: :too_many_requests
  end

  def ensure_owner_token
    return if cookies.signed[:owner_token].present?

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
end
