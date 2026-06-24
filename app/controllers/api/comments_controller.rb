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
  end
end
