module Api
  class SuggestionsController < BaseController
    rate_limit_contributions

    before_action :require_agent!

    # POST /api/docs/:slug/suggestions — propose an edit. It appears live in
    # every connected editor as a pending, agent-attributed suggestion.
    def create
      suggestion = with_document_write_access do
        touch_presence(location: params[:anchor_text].presence || params[:replaces].presence)
        proposed = Suggestion.propose!(
          document:,
          author_name: current_agent,
          author_kind: "agent",
          body: params.require(:body),
          intent: params[:intent].presence,
          anchor_text: params[:anchor_text].presence,
          replaces: params[:replaces].presence
        )
        DocumentAsset.claim_from_html!(document:, source: proposed.body) if document.html?
        proposed
      end

      # A markdown suggestion can carry an excalidraw sketch fence; audit it so a
      # malformed sketch is reported here rather than discovered only when a
      # human accepts the suggestion and the editor renders "Invalid sketch".
      sketch_audit = document.html? ? nil : MarkdownSketchAudit.call(suggestion.body)
      normalized = suggestion.normalization_changed || sketch_audit&.unrecognized? || false
      warning =
        if suggestion.normalization_changed
          "Unsupported HTML was removed or normalized."
        else
          sketch_audit&.warning_message
        end

      render json: {
        suggestion: suggestion.as_props,
        status: "pending_human_review",
        normalized: normalized,
        warning: warning
      }, status: :created
    rescue ActionController::ParameterMissing
      source_name = document.html? ? "HTML" : "markdown"
      render json: { error: "body is required — the #{source_name} you propose." },
             status: :unprocessable_entity
    end
  end
end
