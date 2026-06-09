module Api
  class SuggestionsController < BaseController
    before_action :require_agent!

    # POST /api/docs/:slug/suggestions — propose an edit. It appears live in
    # every connected editor as a pending, agent-attributed suggestion.
    def create
      touch_presence(location: params[:anchor_text].presence || params[:replaces].presence)
      suggestion = Suggestion.propose!(
        document:,
        author_name: current_agent,
        author_kind: "agent",
        body: params.require(:body),
        intent: params[:intent].presence,
        anchor_text: params[:anchor_text].presence,
        replaces: params[:replaces].presence
      )

      render json: {
        suggestion: suggestion.as_props,
        status: "pending_human_review",
        normalized: suggestion.normalization_changed,
        warning: ("Unsupported HTML was removed or normalized." if suggestion.normalization_changed)
      }, status: :created
    rescue ActionController::ParameterMissing
      source_name = document.html? ? "HTML" : "markdown"
      render json: { error: "body is required — the #{source_name} you propose." },
             status: :unprocessable_entity
    end
  end
end
