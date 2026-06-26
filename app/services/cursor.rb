module Cursor
  module_function

  def client
    Rails.application.config.x.cursor_client || Client.new
  end
end
