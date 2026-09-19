# One plugin from a Claude Code plugin marketplace (`.claude-plugin/
# marketplace.json`, `skills/<name>/SKILL.md`), pinned to a commit and stored
# with the lenses CompoundWriting::LensBuilder derived from its skills. The
# row is the lock: locator plus SHA. Accounts subscribe through
# UserWritingPack; the pack itself is shared.
class WritingPack < ApplicationRecord
  SOURCE_KINDS = %w[github gitlab url directory].freeze

  has_many :user_writing_packs, dependent: :destroy
  has_many :users, through: :user_writing_packs

  validates :name, :display_name, :source_locator, :source_sha, :plugin_name, presence: true
  validates :source_kind, inclusion: { in: SOURCE_KINDS }
  validates :plugin_name, uniqueness: { scope: :source_locator }
  validate :lenses_are_valid

  after_save { @lens_structs = nil }

  def reload(*)
    @lens_structs = nil
    super
  end

  def lens_structs
    @lens_structs ||= lenses.map { |lens| CompoundWriting::Lens.from_h(lens) }
  end

  def lens(key) = lens_structs.find { |lens| lens.key == key }
  def lens_keys = lens_structs.map(&:key)

  def short_sha = source_sha.to_s.first(7)

  # `owner/repo@ref` for display and for re-installing.
  def locator_with_ref = source_ref.present? ? "#{source_locator}@#{source_ref}" : source_locator

  def as_props(disabled_keys: [])
    {
      id:, name:, display_name:, description:, version:, source_kind:, source_locator:, source_ref:, source_sha:, short_sha:,
      fetched_at: fetched_at&.iso8601,
      lenses: lens_structs.map { |lens| lens.as_props.merge(enabled: !disabled_keys.include?(lens.key)) }
    }
  end

  private

  def lenses_are_valid
    lens_structs
    errors.add(:lenses, "must not be empty") if lenses.blank?
  rescue ArgumentError => e
    errors.add(:lenses, e.message)
  end
end
