module Api
  module Cli
    class DeviceAuthorizationsController < BaseController
      rate_limit_cli_device_authorization
      rate_limit_cli_token_polling

      def create
        authorization, raw_device_code = CliDeviceAuthorization.start!
        render json: {
          device_code: raw_device_code,
          user_code: authorization.user_code,
          verification_url: cli_authorize_url(code: authorization.user_code),
          expires_in: CliDeviceAuthorization::LIFETIME.to_i,
          interval: CliDeviceAuthorization::POLL_INTERVAL.to_i
        }, status: :created
      end

      def token
        token_record, raw_token = CliDeviceAuthorization.exchange!(params[:device_code])
        render json: {
          access_token: raw_token,
          token_type: "Bearer",
          account: token_record.user.slice(:id, :name, :email)
        }
      rescue CliDeviceAuthorization::InvalidDeviceCode
        render_device_error("invalid_device_code", "That device authorization does not exist.", :not_found)
      rescue CliDeviceAuthorization::AuthorizationPending
        render_device_error("authorization_pending", "Waiting for browser approval.", :too_early)
      rescue CliDeviceAuthorization::PollingTooQuickly
        render_device_error("slow_down", "Wait before polling again.", :too_many_requests)
      rescue CliDeviceAuthorization::Expired
        render_device_error("expired_token", "That device authorization expired.", :gone)
      rescue CliDeviceAuthorization::AlreadyConsumed
        render_device_error("access_denied", "That device authorization was already used.", :gone)
      end

      private

      def render_device_error(code, message, status)
        render json: { error: code, error_description: message }, status:
      end
    end
  end
end
