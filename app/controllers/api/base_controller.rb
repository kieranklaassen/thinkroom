module Api
  # Plain-HTTP surface for agents. Identity comes from the X-Agent-Name
  # header and flows through everything: suggestion attribution, provenance
  # marks on accept, presence chips, and the activity feed.
  class BaseController < ActionController::API
    include WriteRateLimited

    before_action :authenticate_cli_bearer

    rescue_from ActiveRecord::RecordNotFound do
      render json: { error: "No document with that slug." }, status: :not_found
    end

    rescue_from ActiveRecord::RecordInvalid do |e|
      render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end

    rescue_from Document::EditingLockedError do
      render json: {
        error: "This link does not allow editing.",
        link_access: document.link_access,
        editing_locked: true,
        next_action: "Wait for the browser owner to change link access to Can edit, then retry."
      }, status: :locked
    end

    rescue_from Document::CommentingLockedError do
      render json: {
        error: "This link does not allow commenting.",
        link_access: document.link_access,
        next_action: "Wait for the browser owner to allow comments or editing, then retry."
      }, status: :locked
    end

    private

    attr_reader :current_cli_token, :current_api_user

    def authenticate_cli_bearer
      authorization = request.authorization
      return if authorization.blank?

      scheme, raw_token = authorization.split(" ", 2)
      token = CliAccessToken.authenticate(raw_token) if scheme&.casecmp?("Bearer")
      return assign_cli_token(token) if token

      render json: {
        error: "Invalid or revoked Thinkroom access token.",
        next_action: "Run `thinkroom login` to connect this CLI again."
      }, status: :unauthorized
    end

    def assign_cli_token(token)
      @current_cli_token = token
      @current_api_user = token.user
    end

    def require_cli_user!
      return if current_api_user

      render json: {
        error: "A Thinkroom access token is required.",
        next_action: "Run `thinkroom login` first."
      }, status: :unauthorized
    end

    def render_write_rate_limit
      render json: { error: "Write rate limit exceeded; retry later." }, status: :too_many_requests
    end

    def document
      @document ||= Document.find_by!(slug: params[:slug])
    end

    def current_agent
      request.headers["X-Agent-Name"].presence
    end

    # Writes require identity — and the error teaches the fix.
    def require_agent!
      return if current_agent

      render json: {
        error: "Missing X-Agent-Name header.",
        how_to_participate: "Send your agent's display name in an X-Agent-Name header on every request. " \
                            "That name becomes your identity everywhere: presence, suggestion attribution, " \
                            "provenance marks when humans accept your text, and the activity feed.",
        example: participation_example
      }, status: :unprocessable_entity
    end

    def with_document_write_access(&block)
      document.with_write_access(&block)
    end

    def with_document_comment_access(&block)
      document.with_comment_access(&block)
    end

    def participation_example
      case controller_name
      when "suggestions"
        %(curl -X POST #{request.base_url}/api/docs/#{params[:slug]}/suggestions -H "X-Agent-Name: Scout" -H "Content-Type: application/json" -d '{"body": "Proposed text."}')
      when "comments"
        %(curl -X POST #{request.base_url}/api/docs/#{params[:slug]}/comments -H "X-Agent-Name: Scout" -H "Content-Type: application/json" -d '{"body": "Consider a source here."}')
      when "presences"
        %(curl -X POST #{request.base_url}/api/docs/#{params[:slug]}/presence -H "X-Agent-Name: Scout" -H "Content-Type: application/json" -d '{"status": "active"}')
      when "events"
        if action_name == "ack"
          %(curl -X POST #{request.base_url}/api/docs/#{params[:slug]}/events/ack -H "X-Agent-Name: Scout" -H "Content-Type: application/json" -d '{"last_event_id": 123}')
        else
          %(curl #{request.base_url}/api/docs/#{params[:slug]}/events/pending -H "X-Agent-Name: Scout")
        end
      when "uploads"
        %(curl -X POST #{request.base_url}/api/uploads -H "X-Agent-Name: Scout" -F "file=@figure.png")
      else
        %(curl #{request.base_url}#{request.path} -H "X-Agent-Name: Scout")
      end
    end

    # Every authenticated agent call keeps its presence fresh.
    def touch_presence(location: nil)
      return unless current_agent

      _presence, newly_arrived = AgentPresence.touch!(
        document:, agent_name: current_agent, location_text: location
      )
      if newly_arrived
        Activity.log!(
          document:, actor_name: current_agent, actor_kind: "agent",
          action: "joined", detail: "joined via the agent API"
        )
      end
    end
  end
end
