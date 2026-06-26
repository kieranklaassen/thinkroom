module DocumentWriteAuthorization
  extend ActiveSupport::Concern

  included do
    rescue_from Document::EditingLockedError, with: :render_document_read_only
  end

  private

  def with_document_write_access(document, &block)
    @write_document = document
    document.with_write_access(token: owner_token, user: current_user, &block)
  end

  def render_document_read_only
    document = @write_document
    if request.format.json?
      render json: { error: "This document is read-only. Only its owner can make changes." },
             status: :locked
    else
      redirect_back fallback_location: document ? document_page_path(document.slug) : root_path,
                    inertia: { errors: { document: "This document is read-only" } }
    end
  end
end
