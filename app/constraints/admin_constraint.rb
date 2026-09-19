# Route constraint for admin-only mounts (Flipper UI). Thinkroom has no
# Devise, so this reads the signed-in account from the session the way
# ApplicationController#current_user does and requires User#admin?. A request
# that does not match falls through to 404, like Cora's
# `authenticated :user, ->(u) { u.admin? }` block.
class AdminConstraint
  def matches?(request)
    user_id = request.session[:user_id]
    return false if user_id.blank?

    User.where(id: user_id, admin: true).exists?
  end
end
