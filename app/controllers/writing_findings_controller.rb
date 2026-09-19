# Hides one finding for everyone until the next pass. Featured accounts with
# write access, like starting a pass: findings belong to the document's
# writers.
class WritingFindingsController < InertiaController
  include DocumentWriteAuthorization
  include CompoundWritingAccess
  before_action :require_compound_writing

  def dismiss
    finding = WritingFinding.find(params[:id])
    document = finding.document
    with_document_write_access(document) { finding.dismiss! }

    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue ActiveRecord::RecordNotFound
    # The finding's pass was replaced while its card was on screen.
    redirect_back fallback_location: root_path,
                  inertia: { errors: { writing_pass: "That finding is no longer available" } }
  end
end
