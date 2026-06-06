class Document < ApplicationRecord
  DEFAULT_SEED = "# Untitled\n\nStart writing — everything you type is attributed to you.\n"

  # A stale seed claim (seeder crashed or never connected before its first
  # update persisted) is reclaimable after this window.
  SEED_CLAIM_TIMEOUT = 30.seconds

  # Docs that must never be claimed: claiming's only power is delete, and
  # deleting the demo would take it away from everyone.
  UNCLAIMABLE_SLUGS = %w[demo].freeze

  # Raised when claiming a doc that is deliberately unclaimable — distinct
  # from a lost claim race so the UI never shows a phantom winner.
  class UnclaimableError < StandardError; end

  # Raised when another browser won the claim race — a domain event, kept
  # separate from RecordInvalid so real validation errors can't masquerade
  # as "already claimed".
  class ClaimRaceError < StandardError; end

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
  # seed_author_name travels to every doc opener via props and the channel
  # seed grant — same amplification surface as owner_name, same cap.
  validates :seed_author_name, length: { maximum: 255 }, allow_nil: true

  def to_param = slug

  def claimed? = owner_token.present?

  def claimable? = !claimed? && UNCLAIMABLE_SLUGS.exclude?(slug)

  # Never true for blank tokens — the delete-authorization predicate must not
  # match an unclaimed doc against a missing cookie.
  def owned_by?(token)
    token.present? && owner_token == token
  end

  # One normalization rule for display names: strip, cap, nil for blank.
  # nil matters — the identity endpoint clears the session on blank rather
  # than storing a fallback.
  def self.normalize_display_name(raw)
    raw.to_s.strip.first(255).presence
  end

  # Owner names additionally fall back to "Anonymous" (ownership rows always
  # carry a name).
  def self.normalize_owner_name(raw)
    normalize_display_name(raw) || "Anonymous"
  end

  # Atomic first-claim-wins, mirroring the seed-claim pattern: the conditional
  # UPDATE's affected-row count picks exactly one winner under concurrency.
  # Model owns the transition + activity + broadcast (Suggestion.propose!
  # convention). Re-claim by the owning token is a no-op success — checked
  # again after reload so even two same-token requests racing each other
  # (double-click, second tab) never surface a fake lost-race error.
  def claim!(token:, name:)
    raise UnclaimableError, "This document cannot be claimed." if UNCLAIMABLE_SLUGS.include?(slug)
    return self if owned_by?(token)

    name = self.class.normalize_owner_name(name)
    activity = nil
    # Ownership and its activity commit together: a failed activity insert
    # must not leave the doc silently claimed with no feed entry and no
    # broadcast. Broadcasts happen after commit — they can't be rolled back.
    transaction do
      won = self.class.where(id: id, owner_token: nil)
        .update_all(owner_token: token, owner_name: name, claimed_at: Time.current, updated_at: Time.current) == 1

      reload
      unless won
        return self if owned_by?(token) # lost to ourselves: another tab/click with this token won

        raise ClaimRaceError, "already claimed"
      end

      activity = activities.create!(
        actor_name: name, actor_kind: "human",
        action: "claimed_document", detail: "#{name} claimed this document"
      )
    end

    DocumentMetaChannel.broadcast_event(self, :activities) if activity
    DocumentMetaChannel.broadcast_event(self, :ownership)
    self
  end

  # Exactly one client seeds an empty document from its markdown template.
  # The atomic UPDATE claims it; the affected-row count picks exactly one
  # winner under concurrency. Shared by both grant paths — the HTTP page
  # render (documents#show, so a fresh doc seeds from props without waiting
  # for the WebSocket) and the SyncChannel subscribe handshake (fallback for
  # stale-claim reclaim when an HTTP-granted seeder never applied).
  def try_claim_seed
    return false if yjs_state.present? || seed_markdown.blank?
    # Read-side short-circuit: a fresh claim can't be won, so don't issue
    # a write per page load of a just-claimed doc. The conditional UPDATE
    # below remains the single source of truth under concurrency.
    return false if seed_state == "claimed" && seed_claimed_at&.after?(SEED_CLAIM_TIMEOUT.ago)

    self.class
      .where(id: id)
      .where(
        "seed_state = 'pending' OR (seed_state = 'claimed' AND seed_claimed_at < ?)",
        SEED_CLAIM_TIMEOUT.ago
      )
      .update_all(seed_state: "claimed", seed_claimed_at: Time.current) == 1
  end

  def ownership_props(viewer_token)
    {
      claimed: claimed?,
      claimable: claimable?,
      owner_name: owner_name,
      yours: owned_by?(viewer_token)
    }
  end

  # Markdown without provenance span or suggestion-mark markup — the
  # human-readable export. Suggestion tags unwrap keeping content: pending
  # insertions are in the doc, pending deletions are still in the doc until
  # accepted (document-as-is view). Paired-capture so semantic <ins>/<del>
  # without data-suggestion-id are left untouched.
  def plain_markdown
    content_markdown.to_s
      .gsub(/<span data-provenance[^>]*>/, "")
      .gsub("</span>", "")
      .gsub(%r{<(ins|del)\s+data-suggestion-id[^>]*>(.*?)</\1>}m, '\2')
  end

  # Percentage breakdown derived from the latest client-pushed provenance snapshot.
  # Spans: [{ "kind" => "human"|"ai", "state" => ..., "chars" => N }, ...]
  def provenance_summary
    spans = Array(provenance_spans)
    total = spans.sum { |s| s["chars"].to_i }
    return seed_authorship_summary if total.zero?

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

  # Cold-read fallback: before any editor session pushes a snapshot, an
  # agent-seeded doc is 100% unreviewed AI prose — report that instead of
  # zeros. The total approximates rendered length from the markdown source
  # (syntax overhead inflates it); the first real snapshot replaces it.
  # Human and legacy seeds keep returning zeros (no behavior change).
  def seed_authorship_summary
    zeros = { total: 0, human_pct: 0, ai_pct: 0, unreviewed_pct: 0 }
    return zeros unless seed_author_kind == "agent" && seed_markdown.present?

    { total: seed_markdown.length, human_pct: 0, ai_pct: 100, unreviewed_pct: 100 }
  end

  def ensure_slug
    self.slug ||= SecureRandom.base58(10)
  end
end
