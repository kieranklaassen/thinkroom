module Api
  class PresencesController < BaseController
    before_action :require_agent!

    # POST /api/docs/:slug/presence — announce yourself (status: active) or
    # sign off (status: done). location is the text you're working near; the
    # UI renders a labeled cursor there.
    def create
      status = params[:status].presence_in(%w[active done]) || "active"
      _presence, newly_arrived = AgentPresence.touch!(
        document:,
        agent_name: current_agent,
        status:,
        location_text: params[:location].presence
      )

      if newly_arrived
        Activity.log!(
          document:, actor_name: current_agent, actor_kind: "agent",
          action: "joined", detail: "announced presence"
        )
      elsif status == "done"
        Activity.log!(
          document:, actor_name: current_agent, actor_kind: "agent",
          action: "left", detail: "signed off"
        )
      end

      render json: {
        presence: { agent_name: current_agent, status: },
        agents_present: document.agent_presences.active.map(&:as_props)
      }, status: :ok
    end
  end
end
