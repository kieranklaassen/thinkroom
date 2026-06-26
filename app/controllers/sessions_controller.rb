class SessionsController < InertiaController
  DUMMY_PASSWORD_DIGEST = BCrypt::Password.create("not-a-real-user-password").freeze

  rate_limit_authentication

  def new
    remember_return_to
    render_auth_page("login")
  end

  def create
    user = User.find_by(email: params[:email].to_s.strip.downcase)
    digest = user&.password_digest || DUMMY_PASSWORD_DIGEST
    password_matches = BCrypt::Password.new(digest).is_password?(params[:password].to_s)

    if user&.password_account? && password_matches
      redirect_to complete_authentication(user), status: :see_other
    else
      redirect_to auth_path_with_return(login_path),
                  inertia: { errors: { email: "Invalid email or password" } }
    end
  end

  def destroy
    reset_session
    replace_owner_token!
    redirect_to root_path, status: :see_other
  end
end
