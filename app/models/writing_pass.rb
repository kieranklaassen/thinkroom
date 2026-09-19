# One run of the compound writing reviewers over a document: the paragraphs
# the client saw, the reviewers asked, and each reviewer's progress. A document
# has one pass at a time; starting a new one replaces the previous pass and its
# findings. Reviewer jobs write their own entry in `reviewer_runs` under a row
# lock and derive the pass status from the whole map.
class WritingPass < ApplicationRecord
  # Shared by the pass and each reviewer's run entry.
  STATUSES = %w[queued running finished failed].freeze
  MAX_WORDS = 6_000
  MAX_CHARS = 60_000
  MAX_PARAGRAPHS = 400
  PARAGRAPH_KINDS = %w[paragraph heading].freeze

  class TooLarge < StandardError; end
  # A pass is running, or the document's cooldown has not elapsed.
  class Throttled < StandardError; end
  # The text and reviewers match the finished pass; nothing to spend.
  class Unchanged < StandardError
    attr_reader :pass

    def initialize(pass)
      @pass = pass
      super("Nothing has changed since the last run; the findings are current.")
    end
  end

  belongs_to :document
  has_many :findings, class_name: "WritingFinding", inverse_of: :writing_pass, dependent: :delete_all

  validates :status, inclusion: { in: STATUSES }
  validates :requested_by_name, presence: true
  validates :reviewer_keys, presence: true

  # Normalises the client's paragraph payload and enforces the caps (KTD9).
  def self.prepare_paragraphs(raw)
    paragraphs = Array(raw).each_with_index.filter_map do |paragraph, position|
      attributes = paragraph.respond_to?(:to_h) ? paragraph.to_h.with_indifferent_access : {}
      text = attributes[:text].to_s
      next if text.strip.empty?

      kind = PARAGRAPH_KINDS.include?(attributes[:kind].to_s) ? attributes[:kind].to_s : "paragraph"
      index = Integer(attributes[:index], exception: false) || position
      { "index" => index, "kind" => kind, "text" => text }
    end
    raise TooLarge, "The document has too many blocks to review (limit #{MAX_PARAGRAPHS})" if paragraphs.size > MAX_PARAGRAPHS

    chars = paragraphs.sum { |paragraph| paragraph["text"].length }
    raise TooLarge, "The document is too long to review (limit #{MAX_CHARS.to_fs(:delimited)} characters)" if chars > MAX_CHARS

    words = paragraphs.sum { |paragraph| CompoundWriting::Segmenter.word_count(paragraph["text"]) }
    raise TooLarge, "The document is too long to review (limit #{MAX_WORDS.to_fs(:delimited)} words)" if words > MAX_WORDS

    [ paragraphs, words ]
  end

  # The single entry point for a run: refuses a pass that would repeat, crowd,
  # or overspend (Throttled, Unchanged, PassBudget::Exceeded), then replaces
  # the document's earlier passes, logs the activity, and enqueues one job per
  # lens after commit. `lenses` are CompoundWriting::Lens structs the caller
  # already validated against the account's LensSet; the pass snapshots them.
  def self.start!(document:, requested_by_name:, lenses:, paragraphs:, now: Time.current)
    lenses = Array(lenses).uniq(&:key)
    raise ArgumentError, "choose at least one reviewer" if lenses.empty?

    keys = lenses.map(&:key)
    paragraphs, words = prepare_paragraphs(paragraphs)
    digest = CompoundWriting::ParagraphDigest.of(paragraphs.map { |paragraph| paragraph["text"] })
    previous = document.writing_passes.order(created_at: :desc).first
    previous&.refuse_replacement!(keys, digest, now:)
    estimate = CompoundWriting::PassBudget.check!(paragraphs, lenses)

    pass = transaction do
      document.writing_passes.destroy_all
      created = document.writing_passes.create!(
        requested_by_name:, reviewer_keys: keys, lenses: lenses.map(&:to_h), paragraphs:, word_count: words, paragraphs_digest: digest,
        estimated_nouls: estimate.nouls, estimated_calls: estimate.calls,
        reviewer_runs: keys.to_h { |key| [ key, { "status" => "queued" } ] }
      )
      Activity.log!(
        document:, actor_name: requested_by_name, actor_kind: "human", action: "ran_writing_reviewers",
        detail: lenses.map(&:name).to_sentence
      )
      created
    end
    DocumentMetaChannel.broadcast_event_after_commit(document, :writing_pass)
    # The controller may still hold the write-access transaction open; a job
    # that starts before it commits would not find its pass.
    ActiveRecord.after_all_transactions_commit do
      keys.each { |key| WritingReviewerJob.perform_later(pass.id, key) }
    end
    pass
  end

  # Raises when this pass must not be replaced yet: it is still being judged
  # (unless it has stalled past Limits.stall_seconds), the document is inside
  # its cooldown, or the request repeats a pass that finished with every
  # reviewer done. A failed pass never short-circuits: rerunning it is the
  # point.
  def refuse_replacement!(keys, digest, now: Time.current)
    age = now - created_at
    if !finished? && age < CompoundWriting::Limits.stall_seconds
      raise Throttled, "A pass is already running on this document; wait for it to finish."
    end
    if status == "finished" && paragraphs_digest == digest && reviewer_keys == keys
      raise Unchanged, self
    end
    since_last = now - (finished_at || created_at)
    cooldown = CompoundWriting::Limits.cooldown_seconds
    return if since_last >= cooldown

    raise Throttled, "Wait #{(cooldown - since_last).ceil} more second#{(cooldown - since_last).ceil == 1 ? '' : 's'} before running the reviewers again."
  end

  def finished? = status.in?(%w[finished failed])

  # The lens definitions this pass ran with (its own snapshot).
  def lens_structs
    @lens_structs ||= lenses.map { |lens| CompoundWriting::Lens.from_h(lens) }
  end

  def lens(key) = lens_structs.find { |lens| lens.key == key }

  # Updates one reviewer's entry under a row lock and re-derives the pass
  # status, so concurrent reviewer jobs never lose each other's writes.
  def record_run!(reviewer_key, status:, error: nil, findings_count: nil)
    raise ArgumentError, "unknown run status #{status.inspect}" unless STATUSES.include?(status)

    with_lock do
      runs = reviewer_runs.deep_dup
      entry = (runs[reviewer_key] || {}).merge("status" => status)
      entry["error"] = error.to_s.byteslice(0, 300) if error
      entry["findings_count"] = findings_count if findings_count
      entry["finished_at"] = Time.current.iso8601 if %w[finished failed].include?(status)
      runs[reviewer_key] = entry
      statuses = runs.values.map { |run| run["status"] }
      pass_status = if statuses.all? { |value| %w[finished failed].include?(value) }
        statuses.all?("failed") ? "failed" : "finished"
      elsif statuses.any? { |value| %w[running finished failed].include?(value) }
        "running"
      else
        "queued"
      end
      update!(reviewer_runs: runs, status: pass_status, finished_at: pass_status.in?(%w[finished failed]) ? Time.current : nil)
    end
    DocumentMetaChannel.broadcast_event_after_commit(document, :writing_pass)
  end

  def as_props
    {
      id:, status:, reviewer_keys:, reviewer_runs:, word_count:,
      lenses: lens_structs.map(&:as_props),
      paragraph_count: paragraphs.size,
      # The client hashes its live projection the same way to say "text
      # changed since the last run" even where no finding was touched.
      paragraphs_digest:,
      created_at: created_at.iso8601, finished_at: finished_at&.iso8601,
      findings: findings.active.order(:paragraph_index, :quote_offset, :id).map(&:as_props)
    }
  end
end
