class FeedbackBundlesController < ApplicationController
  include ActiveStorage::SetCurrent

  skip_before_action :ensure_owner_token

  def show
    run = FeedbackRun.find_signed!(params[:token], purpose: :feedback_bundle)
    raise ActiveRecord::RecordNotFound unless run.archive.attached?

    redirect_to run.archive.blob.url(expires_in: 10.minutes, disposition: :attachment),
                allow_other_host: true
  rescue ActiveSupport::MessageVerifier::InvalidSignature
    head :not_found
  end
end
