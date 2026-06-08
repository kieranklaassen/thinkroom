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
    # No explicit `status:` on error-bag redirects: InertiaRails' middleware
    # only preserves staged `inertia: { errors: }` session data across 301/302
    # responses (it upgrades Inertia PATCH/PUT/DELETE redirects to 303 itself).
    # An explicit 303 here makes the middleware delete the errors before the
    # follow-up request can render them.
    redirect_back fallback_location: document_page_path(params[:slug]),
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
    # No `status:` on error-bag redirects — see create's rescue.
    redirect_back fallback_location: document_page_path(@suggestion.document.slug),
                  inertia: { errors: { suggestion: "is no longer pending" } }
  end

  def reject
    @suggestion.reject!(by: preferred_name(params[:by], fallback: "human"))
    log_and_broadcast("rejected_suggestion", "rejected “#{@suggestion.intent.presence || 'a suggestion'}” from #{@suggestion.author_name}")
    redirect_back fallback_location: document_page_path(@suggestion.document.slug), status: :see_other
  rescue ActiveRecord::RecordInvalid
    # No `status:` on error-bag redirects — see create's rescue.
    redirect_back fallback_location: document_page_path(@suggestion.document.slug),
                  inertia: { errors: { suggestion: "is no longer pending" } }
  end

  private

  def set_suggestion
    @suggestion = Suggestion.find(params[:id])
  rescue ActiveRecord::RecordNotFound
    # The suggestion (or its doc) was deleted while the card was on screen —
    # redirect back cleanly instead of a 404 modal over the editor.
    # No `status:` on error-bag redirects — see create's rescue.
    redirect_back fallback_location: root_path,
                  inertia: { errors: { suggestion: "is no longer available" } }
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
