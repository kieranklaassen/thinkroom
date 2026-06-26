module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    attr_reader :owner_token

    def connect
      @owner_token = cookies.signed[:owner_token]
      user_id = request.session[:user_id]
      unless user_id
        session_key = Rails.application.config.session_options.fetch(:key)
        session_data = cookies.encrypted[session_key] || {}
        user_id = session_data["user_id"] || session_data[:user_id]
      end
      self.current_user = User.find_by(id: user_id)
    end
  end
end
