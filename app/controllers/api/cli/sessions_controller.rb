module Api
  module Cli
    class SessionsController < BaseController
      before_action :require_cli_user!

      def show
        render json: {
          account: current_api_user.slice(:id, :name, :email),
          token: { name: current_cli_token.name, created_at: current_cli_token.created_at }
        }
      end

      def destroy
        current_cli_token.revoke!
        head :no_content
      end
    end
  end
end
