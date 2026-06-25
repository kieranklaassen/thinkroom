module Api
  class CommentsController < BaseController
    rate_limit_contributions

    before_action :require_agent!

    # POST /api/docs/:slug/comments — leave a comment anchored to text.
    def create
      comment = Comment.post!(
        document:,
        author_name: current_agent,
        author_kind: "agent",
        body: params.require(:body),
        anchor_text: params[:anchor_text].presence
      )
      touch_presence(location: comment.anchor_text)

      render json: { comment: comment.as_props }, status: :created
    rescue ActionController::ParameterMissing
      render json: { error: "body is required — what you want to say." }, status: :unprocessable_entity
    end

    # POST /api/docs/:slug/comments/:id/resolve — close a comment thread.
    # The web UI resolves over a CSRF-protected Inertia request; agents get the
    # same capability here over plain HTTP, attributed via X-Agent-Name.
    def resolve
      comment = document.comments.find(params[:id])
      comment.resolve!
      Activity.log!(
        document:, actor_name: current_agent, actor_kind: "agent",
        action: "resolved_comment", detail: comment.body.truncate(80)
      )
      DocumentMetaChannel.broadcast_event(document, :comments)
      touch_presence(location: comment.anchor_text)

      render json: { comment: comment.as_props }
    rescue ActiveRecord::RecordNotFound
      render json: { error: "No comment with that id on this document." }, status: :not_found
    end
  end
end
