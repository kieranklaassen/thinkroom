# Starts a compound writing pass: the client posts the reviewers it wants and
# the paragraphs it sees; the reviewers run in background jobs and stream
# findings back through the meta channel. Writers only, because a pass spends
# TypeSafe credits, and every pass is bounded: per-address and per-document
# daily caps here (429 with a message the panel shows), and per-document
# throttles plus a per-pass question budget in WritingPass.start!.
class WritingPassesController < InertiaController
  include DocumentWriteAuthorization
  rate_limit_contributions
  before_action :enforce_daily_pass_caps, only: :create

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
  rescue WritingPass::Unchanged => e
    # Not an error: the finished pass already answers this request. The panel
    # shows the notice and keeps the existing findings.
    redirect_back fallback_location: document_page_path(params[:slug]),
                  inertia: { errors: { writing_pass_notice: e.message } }
  rescue ArgumentError, WritingPass::TooLarge, WritingPass::Throttled, CompoundWriting::PassBudget::Exceeded, ActiveRecord::RecordInvalid => e
    # No explicit `status:` on error-bag redirects (see CommentsController#create).
    message = e.is_a?(ActiveRecord::RecordInvalid) ? e.record.errors.full_messages.to_sentence : e.message
    redirect_back fallback_location: document_page_path(params[:slug]),
                  inertia: { errors: { writing_pass: message } }
  end

  private

  def pass_params
    params.permit(:slug, :requested_by_name, reviewers: [], paragraphs: %i[index kind text])
  end

  # Same mechanics as Rails' rate_limit (a counter per window in the shared
  # store), written out so the limits read CompoundWriting::Limits live and
  # each cap renders its own message. Counted per attempt, so a client that
  # keeps posting throttled or unchanged requests still burns its cap.
  def enforce_daily_pass_caps
    window = 1.day
    ip_count = WriteRateLimited::STORE.increment("writing-pass-ip-daily:#{request.remote_ip}", 1, expires_in: window)
    if ip_count > CompoundWriting::Limits.ip_daily_passes
      return render plain: "This address has reached today's limit of #{CompoundWriting::Limits.ip_daily_passes} reviewer runs. Try again tomorrow.",
                    status: :too_many_requests
    end

    document_count = WriteRateLimited::STORE.increment("writing-pass-document-daily:#{params[:slug]}", 1, expires_in: window)
    return unless document_count > CompoundWriting::Limits.document_daily_passes

    render plain: "This document has reached today's limit of #{CompoundWriting::Limits.document_daily_passes} reviewer runs. Try again tomorrow.",
           status: :too_many_requests
  end
end
