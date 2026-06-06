class SuggestionsController < InertiaController
  before_action :set_suggestion, only: [ :accept, :reject ]

  # Browser-facing suggest-a-change (Suggest mode). Mirrors comments#create:
  # the session display name wins over the posted one, the author kind is
  # forced server-side — a browser can never mint agent/ai-attributed
  # suggestions — and everything flows through propose! so activity logging
  # and the live broadcast stay uniform with the agent path.
  def create
    document = Document.find_by!(slug: params[:slug])
    Suggestion.propose!(
      document:,
      author_name: preferred_name(params[:author_name], fallback: "Anonymous"),
      author_kind: "human",
      body: params[:body].to_s,
      intent: (params[:intent].presence if params[:intent].is_a?(String)),
      anchor_text: (params[:anchor_text].presence if params[:anchor_text].is_a?(String)),
      replaces: (params[:replaces].presence if params[:replaces].is_a?(String))
    )

    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue ActiveRecord::RecordInvalid => e
    redirect_back fallback_location: document_page_path(params[:slug]), status: :see_other,
                  inertia: { errors: { suggestion: e.record.errors.full_messages.to_sentence } }
  rescue ActiveRecord::RecordNotFound
    # The doc was deleted while the composer was open — go home cleanly.
    redirect_to root_path, status: :see_other
  end

  def accept
    @suggestion.accept!(by: preferred_name(params[:by], fallback: "human"))
    log_and_broadcast("accepted_suggestion", "accepted “#{@suggestion.intent.presence || 'a suggestion'}” from #{@suggestion.author_name}")
    redirect_back fallback_location: document_page_path(@suggestion.document.slug), status: :see_other
  rescue ActiveRecord::RecordInvalid
    redirect_back fallback_location: document_page_path(@suggestion.document.slug),
                  inertia: { errors: { suggestion: "is no longer pending" }, status: :see_other }
  end

  def reject
    @suggestion.reject!(by: preferred_name(params[:by], fallback: "human"))
    log_and_broadcast("rejected_suggestion", "rejected “#{@suggestion.intent.presence || 'a suggestion'}” from #{@suggestion.author_name}")
    redirect_back fallback_location: document_page_path(@suggestion.document.slug), status: :see_other
  rescue ActiveRecord::RecordInvalid
    redirect_back fallback_location: document_page_path(@suggestion.document.slug),
                  inertia: { errors: { suggestion: "is no longer pending" }, status: :see_other }
  end

  private

  def set_suggestion
    @suggestion = Suggestion.find(params[:id])
  end

  def log_and_broadcast(action, detail)
    document = @suggestion.document
    Activity.log!(
      document:,
      actor_name: preferred_name(params[:by], fallback: "Someone"),
      actor_kind: "human",
      action:,
      detail:
    )
    DocumentMetaChannel.broadcast_event(document, :suggestions)
  end
end
