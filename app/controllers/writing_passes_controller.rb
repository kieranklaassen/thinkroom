# Starts a compound writing pass: the client posts the lens keys it wants and
# the paragraphs it sees; the lenses run in background jobs and stream
# findings back through the meta channel. Featured accounts with document
# write access only, because a pass spends TypeSafe credits, and every pass
# is bounded: per-address and per-document daily caps here (429 with a
# message the panel shows), and per-document throttles plus a per-pass
# question budget in WritingPass.start!.
class WritingPassesController < InertiaController
  include DocumentWriteAuthorization
  include CompoundWritingAccess
  rate_limit_contributions
  before_action :require_compound_writing

  class DailyCapReached < StandardError; end

  def create
    document = Document.find_by!(slug: params[:slug])
    unless CompoundWriting.enabled?
      return redirect_back fallback_location: document_page_path(document.slug),
                           inertia: { errors: { writing_pass: "Reviewers are not configured on this server" } }
    end

    # Authorization first: a view-only visitor must not be able to spend or
    # even count against a document's daily budget.
    with_document_write_access(document) do
      check_daily_caps!(document)
      WritingPass.start!(
        document:,
        requested_by_name: preferred_name(params[:requested_by_name], fallback: "Anonymous"),
        lenses: CompoundWriting::LensSet.for(current_user).select!(pass_params[:reviewers]),
        paragraphs: pass_params[:paragraphs]
      )
      count_pass!(document)
    end

    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue DailyCapReached => e
    render plain: e.message, status: :too_many_requests
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

  # Fixed UTC-day windows keyed by date, so a refused attempt can neither
  # extend nor restart the window, and only a pass that actually started is
  # counted (count_pass!). Read-then-increment is not atomic; the process is
  # single-worker and an off-by-one here is harmless.
  def daily_cap_keys(document)
    day = Time.now.utc.to_date.iso8601
    {
      ip: [ "writing-pass-ip-daily:#{day}:#{request.remote_ip}", CompoundWriting::Limits.ip_daily_passes,
            "This address has reached today's limit of #{CompoundWriting::Limits.ip_daily_passes} reviewer runs. Try again tomorrow." ],
      document: [ "writing-pass-document-daily:#{day}:#{document.id}", CompoundWriting::Limits.document_daily_passes,
                  "This document has reached today's limit of #{CompoundWriting::Limits.document_daily_passes} reviewer runs. Try again tomorrow." ]
    }
  end

  def check_daily_caps!(document)
    daily_cap_keys(document).each_value do |key, limit, message|
      raise DailyCapReached, message if WriteRateLimited::STORE.read(key).to_i >= limit
    end
  end

  def count_pass!(document)
    daily_cap_keys(document).each_value do |key, _limit, _message|
      WriteRateLimited::STORE.increment(key, 1, expires_in: 1.day)
    end
  end
end
