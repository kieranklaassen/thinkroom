# An account's compound writing packs: add one by marketplace locator
# (installed or refreshed through CompoundWriting::PackInstaller and
# subscribed), change which of its lenses are on, or drop the subscription.
# The pack row itself is shared and stays for other subscribers.
class WritingPacksController < InertiaController
  include CompoundWritingAccess
  rate_limit_contributions
  before_action :require_compound_writing

  def create
    pack = CompoundWriting::PackInstaller.install!(pack_params[:locator], plugin: pack_params[:plugin].presence)
    subscription = current_user.user_writing_packs.find_or_initialize_by(writing_pack: pack)
    if subscription.new_record?
      subscription.position = (current_user.user_writing_packs.maximum(:position) || -1) + 1
      subscription.disabled_lens_keys = []
    else
      # A refresh keeps the account's choices for lenses that still exist.
      subscription.disabled_lens_keys &= pack.lens_keys
    end
    subscription.save!

    redirect_back fallback_location: root_path, status: :see_other
  rescue CompoundWriting::PackInstaller::Error, ActiveRecord::RecordInvalid => e
    message = e.is_a?(ActiveRecord::RecordInvalid) ? e.record.errors.full_messages.to_sentence : e.message
    redirect_back fallback_location: root_path, inertia: { errors: { writing_pack: message } }
  end

  def update
    subscription = current_user.user_writing_packs.find_by!(writing_pack_id: params[:id])
    subscription.update_disabled!(params.permit(disabled_lens_keys: [])[:disabled_lens_keys])

    redirect_back fallback_location: root_path, status: :see_other
  end

  def destroy
    current_user.user_writing_packs.find_by!(writing_pack_id: params[:id]).destroy!

    redirect_back fallback_location: root_path, status: :see_other
  end

  private

  def pack_params
    params.permit(:locator, :plugin)
  end
end
