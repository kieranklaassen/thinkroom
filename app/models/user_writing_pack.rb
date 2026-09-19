# An account's subscription to one WritingPack version and the lenses it
# switched off. `subscribe!` is the only way in: it moves the account's
# existing subscription for the same plugin to the given version (keeping
# the choices for lenses that still exist) or appends a new one, and never
# touches another account.
class UserWritingPack < ApplicationRecord
  belongs_to :user
  belongs_to :writing_pack

  validates :user_id, uniqueness: { scope: :writing_pack_id }

  Outcome = Data.define(:subscription, :change) do
    def created? = change == :created
    def moved? = change == :moved
    def unchanged? = change == :unchanged
  end

  def self.subscribe!(user, pack)
    existing = user.user_writing_packs.joins(:writing_pack)
                   .find_by(writing_packs: { source_locator: pack.source_locator, plugin_name: pack.plugin_name })
    if existing.nil?
      position = (user.user_writing_packs.maximum(:position) || -1) + 1
      return Outcome.new(subscription: create!(user:, writing_pack: pack, position:, disabled_lens_keys: []), change: :created)
    end
    return Outcome.new(subscription: existing, change: :unchanged) if existing.writing_pack_id == pack.id

    existing.update!(writing_pack: pack, disabled_lens_keys: existing.disabled_lens_keys & pack.lens_keys)
    Outcome.new(subscription: existing, change: :moved)
  end

  def enabled_lenses
    writing_pack.lens_structs.reject { |lens| disabled_lens_keys.include?(lens.key) }
  end

  # Replaces the disabled set, dropping keys the pack no longer carries.
  def update_disabled!(keys)
    update!(disabled_lens_keys: Array(keys).map(&:to_s).uniq & writing_pack.lens_keys)
  end
end
