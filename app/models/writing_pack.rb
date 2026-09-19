# One plugin from a Claude Code plugin marketplace (`.claude-plugin/
# marketplace.json`, `skills/<name>/SKILL.md`) at one commit, stored with the
# lenses CompoundWriting::LensBuilder derived from its skills. A row is one
# immutable version, keyed by (source_locator, plugin_name, source_sha): a
# new commit is a new row, never an overwrite, so re-adding a locator can
# only move the requester's own subscription (UserWritingPack.subscribe!)
# and never changes what another account already installed.
class WritingPack < ApplicationRecord
  SOURCE_KINDS = %w[github gitlab url directory].freeze
  MAX_LENSES = CompoundWriting::Lens::MAX_LENSES_PER_PACK

  has_many :user_writing_packs, dependent: :destroy
  has_many :users, through: :user_writing_packs

  attr_readonly :name, :source_kind, :source_locator, :source_ref, :source_sha, :plugin_name, :version, :lenses

  validates :name, :display_name, :source_locator, :source_sha, :plugin_name, presence: true
  validates :source_kind, inclusion: { in: SOURCE_KINDS }
  validates :source_sha, uniqueness: { scope: %i[source_locator plugin_name] }
  validate :lenses_are_valid

  # Every version of one plugin, newest first.
  scope :versions_of, ->(source_locator, plugin_name) { where(source_locator:, plugin_name:).order(created_at: :desc) }

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
    errors.add(:lenses, "must not be empty") if lenses.blank?
    errors.add(:lenses, "must not exceed #{MAX_LENSES} lenses") if lenses.is_a?(Array) && lenses.size > MAX_LENSES
    lens_structs
  rescue ArgumentError => e
    errors.add(:lenses, e.message)
  end
end
