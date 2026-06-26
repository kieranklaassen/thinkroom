class FeedbackRunsController < ApplicationController
  MAX_ARCHIVE_BYTES = 60.megabytes
  ZIP_MAGIC = "PK\x03\x04".b

  before_action :require_automation_user!
  before_action :set_feedback_run, only: :show

  def create
    upload = params[:archive]
    error = archive_error(upload)
    return render json: { error: }, status: :unprocessable_entity if error

    run = current_user.feedback_runs.find_or_initialize_by(client_session_id: params[:session_id])
    if run.persisted?
      FeedbackRunLauncher.new(run, bundle_url: bundle_url_for(run)).call
      return render json: run.public_status, status: :ok
    end

    FeedbackRun.transaction do
      run.save!
      run.archive.attach(io: upload.tempfile, filename: safe_filename(upload), content_type: "application/zip")
    end
    FeedbackRunLauncher.new(run, bundle_url: bundle_url_for(run)).call
    render json: run.public_status, status: :created
  rescue ActiveRecord::RecordNotUnique
    run = current_user.feedback_runs.find_by!(client_session_id: params[:session_id])
    render json: run.public_status, status: :ok
  end

  def show
    FeedbackRunSync.new(@feedback_run).call
    render json: @feedback_run.reload.public_status
  end

  private

  def require_automation_user!
    return render json: { error: "Sign in to upload feedback." }, status: :unauthorized unless current_user
    return if FeedbackAutomation.allowed?(current_user)

    render json: { error: "Feedback automation is not enabled for this account." }, status: :forbidden
  end

  def set_feedback_run
    @feedback_run = current_user.feedback_runs.find(params[:id])
  end

  def archive_error(upload)
    return "The Riffrec session ID is missing." unless params[:session_id].is_a?(String) && params[:session_id].present?
    return "The Riffrec session ID is too long." if params[:session_id].length > 255
    return "Choose a Riffrec ZIP archive." unless upload.respond_to?(:tempfile)
    return "The Riffrec archive is empty." unless upload.size.to_i.positive?
    return "The Riffrec archive is too large (60 MB maximum)." if upload.size > MAX_ARCHIVE_BYTES
    return "The Riffrec archive must use a .zip filename." unless safe_filename(upload).downcase.end_with?(".zip")

    upload.tempfile.rewind
    magic = upload.tempfile.read(4)
    upload.tempfile.rewind
    "The uploaded file is not a ZIP archive." unless magic == ZIP_MAGIC
  end

  def safe_filename(upload)
    requested = params[:filename] if params[:filename].is_a?(String)
    File.basename(requested.presence || upload.original_filename.to_s).presence || "riffrec.zip"
  end

  def bundle_url_for(run)
    feedback_bundle_url(
      token: run.signed_id(expires_in: 24.hours, purpose: :feedback_bundle),
      host: request.host,
      protocol: request.protocol,
      port: request.optional_port
    )
  end
end
