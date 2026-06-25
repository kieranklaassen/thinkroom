class OauthCallbacksController < InertiaController
  def create
    auth = request.env["omniauth.auth"]
    return google_failure unless valid_google_auth?(auth)

    uid = auth.uid.to_s
    email = auth.info.email.to_s.strip.downcase
    user = User.find_by(google_uid: uid)
    return redirect_to complete_authentication(user), status: :see_other if user

    if User.exists?(email:)
      return redirect_to auth_path_with_return(login_path), inertia: {
        errors: { email: "Use your email and password for this account" }
      }
    end

    name = Document.normalize_display_name(auth.info.name) || email.split("@", 2).first
    user = User.create!(name:, email:, google_uid: uid)
    redirect_to complete_authentication(user), status: :see_other
  rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
    google_failure
  end

  def failure
    google_failure
  end

  private

  def valid_google_auth?(auth)
    return false unless Rails.application.config.x.google_oauth_strategy_configured
    return false unless auth&.provider == "google_oauth2" && auth.uid.present?
    return false if auth.info&.email.blank?

    ActiveModel::Type::Boolean.new.cast(auth.dig("extra", "id_info", "email_verified")) ||
      ActiveModel::Type::Boolean.new.cast(auth.dig("extra", "raw_info", "email_verified"))
  end

  def google_failure
    redirect_to auth_path_with_return(login_path), inertia: {
      errors: { email: "We couldn’t sign you in with Google" }
    }
  end
end
