module Api
  # Plain-HTTP surface for agents. Identity comes from the X-Agent-Name
  # header and flows through everything: suggestion attribution, provenance
  # marks on accept, presence chips, and the activity feed.
  class BaseController < ActionController::API
    rescue_from ActiveRecord::RecordNotFound do
      render json: { error: "No document with that slug." }, status: :not_found
    end

    rescue_from ActiveRecord::RecordInvalid do |e|
      render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end

    private

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
        example: %(curl -X POST #{request.base_url}/api/docs/#{params[:slug]}/suggestions -H "X-Agent-Name: Scout" -H "Content-Type: application/json" -d '{"body": "Proposed text."}')
      }, status: :unprocessable_entity
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
