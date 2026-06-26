class RegistrationsController < InertiaController
  rate_limit_authentication

  def new
    remember_return_to
    render_auth_page("register")
  end

  def create
    user = User.new(registration_params)
    if user.save
      redirect_to complete_authentication(user), status: :see_other
    else
      redirect_to auth_path_with_return(signup_path), inertia: {
        errors: { form: "Couldn’t create that account. Check your details and try again." }
      }
    end
  end

  private

  def registration_params
    params.permit(:name, :email, :password, :password_confirmation)
  end
end
