class SuggestionsController < InertiaController
  before_action :set_suggestion

  def accept
    @suggestion.accept!(by: preferred_name(params[:by].presence || "human"))
    log_and_broadcast("accepted_suggestion", "accepted “#{@suggestion.intent.presence || 'a suggestion'}” from #{@suggestion.author_name}")
    redirect_back fallback_location: document_page_path(@suggestion.document.slug), status: :see_other
  rescue ActiveRecord::RecordInvalid
    redirect_back fallback_location: document_page_path(@suggestion.document.slug),
                  inertia: { errors: { suggestion: "is no longer pending" }, status: :see_other }
  end

  def reject
    @suggestion.reject!(by: preferred_name(params[:by].presence || "human"))
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
      actor_name: preferred_name(params[:by].presence || "Someone"),
      actor_kind: "human",
      action:,
      detail:
    )
    DocumentMetaChannel.broadcast_event(document, :suggestions)
  end
end
