module Api
  # Event polling so agents can react to human activity (bonus surface):
  # GET pending events since your last ack, then ack the high-water mark.
  class EventsController < BaseController
    before_action :require_agent!

    def pending
      presence, = AgentPresence.touch!(document:, agent_name: current_agent)
      events = document.activities
                       .where("id > ?", presence.last_event_id)
                       .where.not(actor_name: current_agent)
                       .order(:id)
                       .limit(100)

      render json: {
        events: events.map(&:as_props),
        ack_with: events.last&.id,
        how_to_ack: "POST #{request.base_url}/api/docs/#{document.slug}/events/ack with {\"last_event_id\": <ack_with>}"
      }
    end

    def ack
      presence, = AgentPresence.touch!(document:, agent_name: current_agent)
      presence.update!(last_event_id: params.require(:last_event_id).to_i)
      head :no_content
    rescue ActionController::ParameterMissing
      render json: { error: "last_event_id is required." }, status: :unprocessable_entity
    end
  end
end
