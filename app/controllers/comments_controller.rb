class CommentsController < InertiaController
  include DocumentWriteAuthorization
  rate_limit_contributions

  def create
    document = Document.find_by!(slug: params[:slug])
    with_document_comment_access(document) do
      Comment.post!(
        document:,
        author_name: preferred_name(params[:author_name], fallback: "Anonymous"),
        author_kind: "human",
        body: params[:body],
        anchor_text: params[:anchor_text].presence
      )
    end

    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue ActiveRecord::RecordInvalid => e
    # No explicit `status:` on error-bag redirects: InertiaRails' middleware
    # only preserves staged `inertia: { errors: }` session data across 301/302
    # responses (it upgrades Inertia PATCH/PUT/DELETE redirects to 303 itself).
    # An explicit 303 here makes the middleware delete the errors before the
    # follow-up request can render them.
    redirect_back fallback_location: document_page_path(params[:slug]),
                  inertia: { errors: { comment: e.record.errors.full_messages.to_sentence } }
  end

  def resolve
    comment = Comment.find(params[:id])
    document = comment.document
    with_document_comment_access(document) do
      comment.resolve!
      Activity.log!(
        document:,
        actor_name: preferred_name(params[:by], fallback: "Someone"),
        actor_kind: "human",
        action: "resolved_comment",
        detail: comment.body.truncate(80)
      )
    end
    DocumentMetaChannel.broadcast_event(document, :comments)

    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue ActiveRecord::RecordNotFound
    # The comment (or its doc) was deleted while the card was on screen, or a
    # stale optimistic id reached the server — redirect back cleanly instead
    # of a 404 modal over the editor. No `status:` — see create's rescue.
    redirect_back fallback_location: root_path,
                  inertia: { errors: { comment: "is no longer available" } }
  end
end
