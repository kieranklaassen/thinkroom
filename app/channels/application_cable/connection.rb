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

    # As in Action Cable, without quoting the frame in the log.
    def dispatch_websocket_message(websocket_message)
      return handle_channel_command(decode(websocket_message)) if websocket.alive?

      logger.error "Ignoring message processed after the WebSocket was closed (#{websocket_message.bytesize} bytes)"
    end

    private

    def decode(websocket_message)
      super
    rescue JSON::ParserError
      raise JSON::ParserError, "message is not valid JSON", cause: nil
    end
  end
end
