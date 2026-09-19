# The account gate for every compound writing endpoint: a signed-in account
# holding the feature (CompoundWriting.available_to?). Everyone else gets the
# same shape the other document write refusals use, so the client's inline
# error handling applies.
module CompoundWritingAccess
  extend ActiveSupport::Concern

  MESSAGE = "Compound writing is not enabled for your account".freeze

  private

  def require_compound_writing
    return if CompoundWriting.available_to?(current_user)

    if request.format.json?
      render json: { error: MESSAGE }, status: :forbidden
    else
      redirect_back fallback_location: root_path, inertia: { errors: { writing_pass: MESSAGE } }
    end
  end
end
