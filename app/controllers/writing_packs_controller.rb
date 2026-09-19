# An account's compound writing packs: add one by marketplace locator
# (installed as an immutable version through CompoundWriting::PackInstaller
# and subscribed), change which of its lenses are on, or drop the
# subscription. Pack versions are shared rows that stay for other
# subscribers.
class WritingPacksController < InertiaController
  include CompoundWritingAccess
  rate_limit_contributions
  before_action :require_compound_writing

  # Installs the version the locator resolves to (an existing row when that
  # commit is already known) and moves only this account's subscription to
  # it; other subscribers keep the version they chose.
  def create
    pack = CompoundWriting::PackInstaller.install!(pack_params[:locator], plugin: pack_params[:plugin].presence)
    UserWritingPack.subscribe!(current_user, pack)

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
