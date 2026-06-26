class CliAuthorizationsController < InertiaController
  before_action :require_account

  def show
    authorization = find_authorization
    render inertia: "cli/authorize", props: authorization_props(authorization)
  end

  def create
    authorization = find_authorization
    authorization&.approve!(current_user)
    redirect_to cli_authorize_path(code: normalized_code), status: :see_other
  rescue CliDeviceAuthorization::Expired, CliDeviceAuthorization::AlreadyConsumed,
         CliDeviceAuthorization::AlreadyApproved
    redirect_to cli_authorize_path(code: normalized_code), status: :see_other
  end

  private

  def require_account
    return if current_user

    redirect_to login_path(return_to: request.fullpath), status: :see_other
  end

  def find_authorization
    CliDeviceAuthorization.includes(:user).find_by(user_code: normalized_code)
  end

  def normalized_code
    CliDeviceAuthorization.normalize_user_code(params[:code])
  end

  def authorization_props(authorization)
    status =
      if authorization.nil?
        "invalid"
      elsif authorization.expired?
        "expired"
      elsif authorization.consumed_at?
        "consumed"
      elsif authorization.approved_at?
        authorization.user_id == current_user.id ? "approved" : "unavailable"
      else
        "ready"
      end

    {
      status:,
      user_code: authorization&.user_code || normalized_code,
      account: current_user.slice(:name, :email)
    }
  end
end
