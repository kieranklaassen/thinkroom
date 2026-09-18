# Starts a compound writing pass: the client posts the reviewers it wants and
# the paragraphs it sees; the reviewers run in background jobs and stream
# findings back through the meta channel. Writers only, because a pass spends
# TypeSafe credits.
class WritingPassesController < InertiaController
  include DocumentWriteAuthorization
  rate_limit_contributions

  def create
    document = Document.find_by!(slug: params[:slug])
    unless CompoundWriting.enabled?
      return redirect_back fallback_location: document_page_path(document.slug),
                           inertia: { errors: { writing_pass: "Reviewers are not configured on this server" } }
    end

    with_document_write_access(document) do
      WritingPass.start!(
        document:,
        requested_by_name: preferred_name(params[:requested_by_name], fallback: "Anonymous"),
        reviewer_keys: pass_params[:reviewers],
        paragraphs: pass_params[:paragraphs]
      )
    end

    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue ArgumentError, WritingPass::TooLarge, ActiveRecord::RecordInvalid => e
    # No explicit `status:` on error-bag redirects (see CommentsController#create).
    message = e.is_a?(ActiveRecord::RecordInvalid) ? e.record.errors.full_messages.to_sentence : e.message
    redirect_back fallback_location: document_page_path(params[:slug]),
                  inertia: { errors: { writing_pass: message } }
  end

  private

  def pass_params
    params.permit(:slug, :requested_by_name, reviewers: [], paragraphs: %i[index kind text])
  end
end
