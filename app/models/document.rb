class Document < ApplicationRecord
  DEFAULT_SEED = "# Untitled\n\nStart writing — everything you type is attributed to you.\n"
  DEFAULT_HTML_SEED = "<h1>Untitled</h1><p>Start writing — everything you type is attributed to you.</p>"
  CONTENT_FORMATS = %w[markdown html].freeze
  MAX_CONTENT_BYTES = 2.megabytes

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

  attr_readonly :slug, :content_format

  has_many :suggestions, dependent: :destroy
  has_many :comments, dependent: :destroy
  has_many :activities, dependent: :destroy
  has_many :agent_presences, dependent: :destroy
  has_many :document_assets, dependent: :destroy
  belongs_to :user, optional: true

  before_validation :ensure_slug, on: :create

  validates :title, presence: true
  validates :slug, presence: true, uniqueness: true
  validates :content_format, inclusion: { in: CONTENT_FORMATS }
  validate :content_format_is_immutable, on: :update
  # owner_name is broadcast to every client and served to agents — unbounded
  # names are an amplification vector, so cap it (deliberate exception to the
  # no-validation convention on author_name).
  validates :owner_name, length: { maximum: 255 }, allow_nil: true
  # seed_author_name travels to every doc opener via props and the channel
  # seed grant — same amplification surface as owner_name, same cap.
  validates :seed_author_name, length: { maximum: 255 }, allow_nil: true
  # The editor AI-attributes any non-nil, non-"human" kind, so an unrecognized
  # value written by a future code path would silently claim text as AI —
  # constrain the vocabulary at the model.
  validates :seed_author_kind, inclusion: { in: %w[human agent] }, allow_nil: true

  def to_param = slug

  def html? = content_format == "html"

  def seed_content = seed_markdown

  def seed_content=(value)
    self.seed_markdown = value
  end

  def content_snapshot = content_markdown

  def content_snapshot=(value)
    self.content_markdown = value
  end

  def default_seed
    html? ? DEFAULT_HTML_SEED : DEFAULT_SEED
  end

  def current_content
    content_snapshot.nil? ? seed_content : content_snapshot
  end

  def plain_text
    DocumentPlainText.call(format: content_format, content: current_content)
  end

  def claimed? = user_id.present? || owner_token.present?

  def claimable? = !claimed? && UNCLAIMABLE_SLUGS.exclude?(slug)

  # Never true for blank tokens — the delete-authorization predicate must not
  # match an unclaimed doc against a missing cookie.
  def owned_by?(token, user: nil)
    return user.present? && user_id == user.id if user_id.present?

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
  def claim!(token:, name:, user: nil)
    raise UnclaimableError, "This document cannot be claimed." if UNCLAIMABLE_SLUGS.include?(slug)
    raise ArgumentError, "token required" if token.blank? && user.nil?
    return self if owned_by?(token, user:)

    name = user&.name || self.class.normalize_owner_name(name)
    activity = nil
    # Ownership and its activity commit together: a failed activity insert
    # must not leave the doc silently claimed with no feed entry and no
    # broadcast. Broadcasts happen after commit — they can't be rolled back.
    transaction do
      attributes = {
        owner_name: name,
        claimed_at: Time.current,
        updated_at: Time.current
      }
      if user
        attributes[:user_id] = user.id
        attributes[:owner_token] = nil
      else
        attributes[:owner_token] = token
      end
      won = self.class.where(id: id, owner_token: nil, user_id: nil)
        .update_all(attributes) == 1

      reload
      unless won
        return self if owned_by?(token, user:) # lost to ourselves: another tab/click won

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

  # Exactly one client seeds an empty document from its source template.
  # The atomic UPDATE claims it; the affected-row count picks exactly one
  # winner under concurrency. Shared by both grant paths — the HTTP page
  # render (documents#show, so a fresh doc seeds from props without waiting
  # for the WebSocket) and the SyncChannel subscribe handshake (fallback for
  # stale-claim reclaim when an HTTP-granted seeder never applied).
  def try_claim_seed
    return false if yjs_state.present? || seed_content.blank?
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

  def ownership_props(viewer_token, viewer_user: nil)
    {
      claimed: claimed?,
      claimable: claimable?,
      owner_name: owner_name,
      yours: owned_by?(viewer_token, user: viewer_user)
    }
  end

  # Markdown source without provenance span or suggestion-mark markup — the
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
    # Fallback only when no snapshot was ever pushed — a pushed snapshot with
    # degenerate zero-char spans must not resurrect the seed-based claim.
    return seed_authorship_summary if spans.empty?
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

  def content_format_is_immutable
    errors.add(:content_format, "cannot be changed") if will_save_change_to_content_format?
  end

  # Cold-read fallback: before any editor session pushes a snapshot, an
  # agent-seeded doc is 100% unreviewed AI prose — report that instead of
  # zeros. The total uses rendered plain text for either source format; the
  # first real snapshot replaces it. Human and legacy seeds keep returning
  # zeros (no behavior change).
  def seed_authorship_summary
    zeros = { total: 0, human_pct: 0, ai_pct: 0, unreviewed_pct: 0 }
    return zeros unless seed_author_kind == "agent" && seed_content.present?

    { total: plain_text.length, human_pct: 0, ai_pct: 100, unreviewed_pct: 100 }
  end

  def ensure_slug
    self.slug ||= SecureRandom.base58(10)
  end
end
