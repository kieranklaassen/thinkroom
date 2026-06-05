class Document < ApplicationRecord
  DEFAULT_SEED = "# Untitled\n\nStart writing — everything you type is attributed to you.\n"

  # Docs that must never be claimed: claiming's only power is delete, and
  # deleting the demo would take it away from everyone.
  UNCLAIMABLE_SLUGS = %w[demo].freeze

  # Raised when claiming a doc that is deliberately unclaimable — distinct
  # from a lost claim race so the UI never shows a phantom winner.
  class UnclaimableError < StandardError; end

  attr_readonly :slug

  has_many :suggestions, dependent: :destroy
  has_many :comments, dependent: :destroy
  has_many :activities, dependent: :destroy
  has_many :agent_presences, dependent: :destroy

  before_validation :ensure_slug, on: :create

  validates :title, presence: true
  validates :slug, presence: true, uniqueness: true
  # owner_name is broadcast to every client and served to agents — unbounded
  # names are an amplification vector, so cap it (deliberate exception to the
  # no-validation convention on author_name).
  validates :owner_name, length: { maximum: 255 }, allow_nil: true

  def to_param = slug

  def claimed? = owner_token.present?

  def claimable? = !claimed? && UNCLAIMABLE_SLUGS.exclude?(slug)

  # Never true for blank tokens — the delete-authorization predicate must not
  # match an unclaimed doc against a missing cookie.
  def owned_by?(token)
    token.present? && owner_token == token
  end

  # Atomic first-claim-wins, mirroring the seed-claim pattern: the conditional
  # UPDATE's affected-row count picks exactly one winner under concurrency.
  # Model owns the transition + activity + broadcast (Suggestion.propose!
  # convention). Re-claim by the owning token is a no-op success so a
  # double-click or second tab never surfaces a fake lost-race error.
  def claim!(token:, name:)
    raise UnclaimableError, "This document cannot be claimed." if UNCLAIMABLE_SLUGS.include?(slug)
    return self if owned_by?(token)

    name = name.to_s.strip.first(255).presence || "Anonymous"
    won = self.class.where(id: id, owner_token: nil)
      .update_all(owner_token: token, owner_name: name, claimed_at: Time.current, updated_at: Time.current) == 1

    reload
    raise ActiveRecord::RecordInvalid.new(self), "already claimed" unless won

    Activity.log!(
      document: self, actor_name: name, actor_kind: "human",
      action: "claimed_document", detail: "#{name} claimed this document"
    )
    DocumentMetaChannel.broadcast_event(self, :ownership)
    self
  end

  def ownership_props(viewer_token)
    {
      claimed: claimed?,
      claimable: claimable?,
      owner_name: owner_name,
      yours: owned_by?(viewer_token)
    }
  end

  # Markdown without provenance span markup — the human-readable export.
  def plain_markdown
    content_markdown.to_s
      .gsub(/<span data-provenance[^>]*>/, "")
      .gsub("</span>", "")
  end

  # Percentage breakdown derived from the latest client-pushed provenance snapshot.
  # Spans: [{ "kind" => "human"|"ai", "state" => ..., "chars" => N }, ...]
  def provenance_summary
    spans = Array(provenance_spans)
    total = spans.sum { |s| s["chars"].to_i }
    return { total: 0, human_pct: 0, ai_pct: 0, unreviewed_pct: 0 } if total.zero?

    human = spans.select { |s| s["kind"] == "human" }.sum { |s| s["chars"].to_i }
    ai = total - human
    unreviewed = spans.select { |s| s["kind"] == "ai" && s["state"] == "pending" }.sum { |s| s["chars"].to_i }

    {
      total: total,
      human_pct: (human * 100.0 / total).round,
      ai_pct: (ai * 100.0 / total).round,
      unreviewed_pct: (unreviewed * 100.0 / total).round
    }
  end

  private

  def ensure_slug
    self.slug ||= SecureRandom.base58(10)
  end
end
