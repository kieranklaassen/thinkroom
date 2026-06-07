class CommentsController < InertiaController
  def create
    document = Document.find_by!(slug: params[:slug])
    Comment.post!(
      document:,
      author_name: preferred_name(params[:author_name], fallback: "Anonymous"),
      author_kind: "human",
      body: params[:body],
      anchor_text: params[:anchor_text].presence
    )

    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue ActiveRecord::RecordInvalid => e
    redirect_back fallback_location: document_page_path(params[:slug]),
                  inertia: { errors: { comment: e.record.errors.full_messages.to_sentence }, status: :see_other }
  end

  def resolve
    comment = Comment.find(params[:id])
    comment.resolve!

    document = comment.document
    Activity.log!(
      document:,
      actor_name: preferred_name(params[:by], fallback: "Someone"),
      actor_kind: "human",
      action: "resolved_comment",
      detail: comment.body.truncate(80)
    )
    DocumentMetaChannel.broadcast_event(document, :comments)

    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue ActiveRecord::RecordNotFound
    # The comment (or its doc) was deleted while the card was on screen, or a
    # stale optimistic id reached the server — redirect back cleanly instead
    # of a 404 modal over the editor.
    redirect_back fallback_location: root_path, status: :see_other,
                  inertia: { errors: { comment: "is no longer available" } }
  end
end
