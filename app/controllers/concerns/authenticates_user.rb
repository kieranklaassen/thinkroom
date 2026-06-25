module AuthenticatesUser
  extend ActiveSupport::Concern

  private

  def complete_authentication(user)
    destination = safe_return_to(session[:return_to])
    anonymous_token = owner_token

    user.claim_documents!(anonymous_token)
    reset_session
    session[:user_id] = user.id
    replace_owner_token!

    destination || root_path
  end

  def remember_return_to
    session[:return_to] = safe_return_to(params[:return_to])
  end

  def render_auth_page(mode)
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

  def safe_return_to(value)
    return if value.blank?

    uri = URI.parse(value.to_s)
    return unless uri.relative? && uri.path.start_with?("/") && !uri.path.start_with?("//")
    return if value.to_s.include?("\\")

    value.to_s
  rescue URI::InvalidURIError
    nil
  end
end
