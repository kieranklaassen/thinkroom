# A proposed edit awaiting human review. Suggestions live in the database —
# not the Yjs doc — until a human accepts one, at which point the accepting
# client inserts the text into the CRDT carrying provenance marks matching
# the author kind (AI marks for ai/agent authors, human marks for human).
class Suggestion < ApplicationRecord
  STATUSES = %w[pending accepted rejected].freeze
  AUTHOR_KINDS = %w[ai agent human].freeze

  # Suggestion text is parsed into every connected client's editor on accept,
  # so the unauthenticated create surfaces must not relay megabyte payloads.
  # Body/replaces share one generous cap; the anchor is tighter — it has to
  # match a real span already in the document.
  MAX_BODY_BYTES = 64.kilobytes
  MAX_ANCHOR_BYTES = 10.kilobytes
  MAX_INTENT_BYTES = 1.kilobyte
  attr_accessor :normalization_changed

  belongs_to :document

  validates :author_name, presence: true
  validates :author_kind, inclusion: { in: AUTHOR_KINDS }
  validates :body, presence: true
  validates :status, inclusion: { in: STATUSES }
  validate :payloads_within_caps

  scope :pending, -> { where(status: "pending") }

  # The single entry point for proposing a suggestion — the UI's AI path and
  # the agent API both flow through here (create + activity + live broadcast),
  # so there is no side channel around the review machinery.
  def self.propose!(document:, author_name:, author_kind:, body:, intent: nil, anchor_text: nil, replaces: nil)
    body = body.to_s
    if body.bytesize > MAX_BODY_BYTES
      invalid = document.suggestions.build(author_name:, author_kind:, body:, intent:, anchor_text:, replaces:)
      invalid.errors.add(:body, "is too long")
      raise ActiveRecord::RecordInvalid.new(invalid)
    end

    normalization = document.html? ? HtmlDocumentSanitizer.external(body) : nil
    suggestion = document.suggestions.create!(
      author_name:, author_kind:, body: normalization&.content || body, intent:, anchor_text:, replaces:,
      status: "pending"
    )
    suggestion.normalization_changed = normalization&.changed? || false
    Activity.log!(
      document:,
      actor_name: author_name,
      actor_kind: author_kind,
      action: "suggested",
      detail: intent.presence || body.truncate(80)
    )
    DocumentMetaChannel.broadcast_event_after_commit(document, :suggestions)
    suggestion
  end

  def accept!(by: nil)
    transition!("accepted", by:)
  end

  # Compensation for the narrow collaboration race where a replacement
  # target changes after the server wins acceptance but before the accepting
  # client can merge it into Yjs. Only that resolver can reopen the exact
  # accepted row, and the compare-and-set prevents changing later state.
  def reopen_after_failed_apply!(by:)
    updated = self.class.where(id:, status: "accepted", resolved_by: by)
                  .update_all(status: "pending", resolved_by: nil, updated_at: Time.current)
    raise ActiveRecord::RecordInvalid.new(self), "cannot reopen" if updated.zero?

    reload
  end

  # Batch accept for the Accept-all button: flips the selected pending rows,
  # or every pending row when ids are omitted, in one transaction. A row
  # resolved concurrently by a single accept loses its pending status and is
  # excluded — the caller only merges winners, so no text applies twice.
  def self.accept_all!(document:, by: nil, ids: nil)
    winners = []
    document.transaction do
      pending = document.suggestions.pending
      pending = pending.where(id: ids) unless ids.nil?
      pending.order(:id).each do |suggestion|
        suggestion.accept!(by:)
        winners << suggestion
      rescue ActiveRecord::RecordInvalid
        # lost to a concurrent resolve between the scope read and this row
      end
    end
    winners
  end

  def reject!(by: nil)
    transition!("rejected", by:)
  end

  # Auto-rejects every pending suggestion belonging to `document` whose
  # `replaces` text is no longer a verbatim substring of `new_content`.
  # Called by Document#replace_content! so a CLI owner replacement doesn't
  # leave suggestions silently targeting text that no longer exists — each
  # rejection logs an Activity explaining why (so the feed isn't a silent
  # disappearance), and the agent API contract surfaces the count so a
  # caller learns about the side effect immediately rather than discovering
  # it through a later failed `suggest` call (see Api::DocsController#update).
  #
  # Deliberately a plain substring containment check, not the client's fuzzy
  # matchQuotedText matching (app/frontend/editor/suggestions.ts) — a false
  # "still matches" here is harmless: the existing client-side applicability
  # check will independently report it missing/ambiguous, same as today.
  # Suggestions with a blank `replaces` (general/anchor-only) have no target
  # to lose and are left untouched.
  def self.auto_reject_stale!(document, new_content:)
    rejected = 0
    document.suggestions.pending.where.not(replaces: [ nil, "" ]).find_each do |suggestion|
      next if new_content.include?(suggestion.replaces)

      suggestion.reject!
      rejected += 1
      Activity.log!(
        document:,
        actor_name: "Thinkroom",
        actor_kind: "system",
        action: "auto_rejected_suggestion",
        detail: "A document replacement removed the text this suggestion targeted: " \
                "#{suggestion.replaces.to_s.truncate(80)}"
      )
    end
    rejected
  end

  def as_props
    slice(:id, :author_name, :author_kind, :intent, :body, :anchor_text, :replaces, :status)
      .merge(created_at: created_at.iso8601)
  end

  private

  def payloads_within_caps
    errors.add(:body, "is too long") if body.to_s.bytesize > MAX_BODY_BYTES
    errors.add(:replaces, "is too long") if replaces.to_s.bytesize > MAX_BODY_BYTES
    errors.add(:anchor_text, "is too long") if anchor_text.to_s.bytesize > MAX_ANCHOR_BYTES
    errors.add(:intent, "is too long") if intent.to_s.bytesize > MAX_INTENT_BYTES
  end

  # Compare-and-set at the DB, mirroring Document#claim!: only a row still
  # pending transitions, so two concurrent accepts (single-vs-single,
  # single-vs-bulk, bulk-vs-bulk across Puma threads) produce exactly one
  # winner — the loser raises and its client never merges, which is the
  # guarantee the whole accept flow's no-duplicate promise rests on. An
  # in-memory status check would pass in BOTH racing requests.
  def transition!(new_status, by:)
    updated = self.class.where(id:, status: "pending")
                  .update_all(status: new_status, resolved_by: by, updated_at: Time.current)
    raise ActiveRecord::RecordInvalid.new(self), "already #{status}" if updated.zero?

    reload
  end
end
