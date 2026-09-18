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

  belongs_to :document
  has_many :findings, class_name: "WritingFinding", dependent: :delete_all

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

  # The single entry point for a run: replaces the document's earlier passes,
  # logs the activity, and enqueues one job per reviewer after commit.
  def self.start!(document:, requested_by_name:, reviewer_keys:, paragraphs:)
    keys = CompoundWriting::Reviewers.normalize_keys(reviewer_keys)
    raise ArgumentError, "choose at least one reviewer" if keys.empty?

    paragraphs, words = prepare_paragraphs(paragraphs)
    pass = transaction do
      document.writing_passes.destroy_all
      created = document.writing_passes.create!(
        requested_by_name:, reviewer_keys: keys, paragraphs:, word_count: words,
        reviewer_runs: keys.to_h { |key| [ key, { "status" => "queued" } ] }
      )
      Activity.log!(
        document:, actor_name: requested_by_name, actor_kind: "human", action: "ran_writing_reviewers",
        detail: keys.map { |key| CompoundWriting::Reviewers.find!(key).name }.to_sentence
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
      paragraph_count: paragraphs.size,
      # The client hashes its live projection the same way to say "text
      # changed since the last run" even where no finding was touched.
      paragraphs_digest: CompoundWriting::ParagraphDigest.of(paragraphs.map { |paragraph| paragraph["text"] }),
      created_at: created_at.iso8601, finished_at: finished_at&.iso8601,
      findings: findings.active.order(:paragraph_index, :quote_offset, :id).map(&:as_props)
    }
  end
end
