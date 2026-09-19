# An account's subscription to a WritingPack and the lenses it switched off.
class UserWritingPack < ApplicationRecord
  belongs_to :user
  belongs_to :writing_pack

  validates :user_id, uniqueness: { scope: :writing_pack_id }

  def enabled_lenses
    writing_pack.lens_structs.reject { |lens| disabled_lens_keys.include?(lens.key) }
  end

  # Replaces the disabled set, dropping keys the pack no longer carries.
  def update_disabled!(keys)
    update!(disabled_lens_keys: Array(keys).map(&:to_s).uniq & writing_pack.lens_keys)
  end
end
