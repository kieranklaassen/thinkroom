# One reviewer over one writing pass, off the request thread. Paragraphs are
# judged one at a time so findings stream to connected editors through the
# meta channel as they land; a Jev failure marks only this reviewer failed.
# A pass replaced by a newer one has been destroyed, so the job stops asking
# Jev at the next paragraph and exits quietly.
class WritingReviewerJob < ApplicationJob
  queue_as :default

  # Raised internally when the pass disappears mid-run.
  class PassReplaced < StandardError; end

  def perform(pass_id, reviewer_key)
    pass = WritingPass.find_by(id: pass_id)
    return unless pass

    reviewer = pass.lens(reviewer_key) or raise ArgumentError, "pass #{pass.id} carries no lens #{reviewer_key}"
    judge = CompoundWriting.judge
    pass.record_run!(reviewer.key, status: "running")
    count = 0

    pass.paragraphs.each do |paragraph|
      raise PassReplaced unless WritingPass.exists?(pass.id)

      findings = CompoundWriting::ParagraphReview.new(reviewer, judge:).call(
        index: paragraph["index"], kind: paragraph["kind"], text: paragraph["text"]
      )
      count += persist(pass, findings)
    end
    raise PassReplaced unless WritingPass.exists?(pass.id)

    count += persist(pass, CompoundWriting::TextReview.new(reviewer, judge:).call(pass.paragraphs))
    pass.record_run!(reviewer.key, status: "finished", findings_count: count)
  rescue PassReplaced, ActiveRecord::RecordNotFound, ActiveRecord::InvalidForeignKey
    # The pass was replaced while this reviewer was running; its rows are gone.
    nil
  rescue CompoundWriting::JudgeError => e
    fail_run(pass, reviewer_key, e.message, count)
  rescue StandardError => e
    # Anything else must not leave the reviewer "running" forever (the panel
    # would show a spinner that never resolves).
    Rails.logger.error("[compound] #{reviewer_key} crashed on pass #{pass_id}: #{e.class}: #{e.message}")
    fail_run(pass, reviewer_key, "#{e.class.name.demodulize}: #{e.message.to_s.byteslice(0, 200)}", count)
  end

  private

  def fail_run(pass, reviewer_key, message, count)
    Rails.logger.warn("[compound] #{reviewer_key} failed on pass #{pass&.id}: #{message}")
    pass&.record_run!(reviewer_key, status: "failed", error: message, findings_count: count)
  rescue ActiveRecord::RecordNotFound
    nil
  end

  def persist(pass, findings)
    return 0 if findings.empty?

    WritingFinding.transaction do
      findings.each { |finding| WritingFinding.from_review(finding, pass:).save! }
    end
    DocumentMetaChannel.broadcast_event_after_commit(pass.document, :writing_pass)
    findings.size
  end
end
