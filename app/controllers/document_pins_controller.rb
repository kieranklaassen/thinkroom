# Pins a document to the current owner's Pinned list on the index, or takes
# it off. A pin is a private bookmark, so any readable document can be pinned
# without an ownership check. Both actions are idempotent; redirects follow
# the update_tags contract (303 on success, a plain 302 carrying the errors
# bag so the client's onError fires).
class DocumentPinsController < InertiaController
  # Guests can rotate their owner token and dodge the per-owner cap, so pin
  # creation shares the per-IP contribution limits.
  rate_limit_contributions

  # A document deleted while the request was in flight: go home cleanly.
  rescue_from ActiveRecord::RecordNotFound do
    redirect_to root_path, status: :see_other
  end

  def create
    DocumentPin.pin!(document, user: current_user, token: owner_token)
    redirect_back fallback_location: root_path, status: :see_other
  rescue DocumentPin::CapReached => e
    redirect_back fallback_location: root_path, inertia: { errors: { pin: e.message } }
  end

  def destroy
    DocumentPin.unpin!(document, user: current_user, token: owner_token)
    redirect_back fallback_location: root_path, status: :see_other
  end

  private

  def document
    @document ||= Document.find_by!(slug: params[:slug])
  end
end
