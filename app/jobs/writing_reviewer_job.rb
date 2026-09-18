# One reviewer over one writing pass, off the request thread. Paragraphs are
# judged one at a time so findings stream to connected editors through the
# meta channel as they land; a Jev failure marks only this reviewer failed.
# A pass replaced by a newer one has been destroyed, so the job exits quietly.
class WritingReviewerJob < ApplicationJob
  queue_as :default

  def perform(pass_id, reviewer_key)
    pass = WritingPass.find_by(id: pass_id)
    return unless pass

    reviewer = CompoundWriting::Reviewers.find!(reviewer_key)
    judge = CompoundWriting.judge
    pass.record_run!(reviewer.key, status: "running")
    count = 0

    pass.paragraphs.each do |paragraph|
      findings = CompoundWriting::ParagraphReview.new(reviewer, judge:).call(
        index: paragraph["index"], kind: paragraph["kind"], text: paragraph["text"]
      )
      count += persist(pass, findings)
    end
    count += persist(pass, CompoundWriting::TextReview.new(reviewer, judge:).call(pass.paragraphs))

    pass.record_run!(reviewer.key, status: "finished", findings_count: count)
  rescue CompoundWriting::JudgeError => e
    Rails.logger.warn("[compound] #{reviewer_key} failed on pass #{pass_id}: #{e.message}")
    pass&.record_run!(reviewer_key, status: "failed", error: e.message, findings_count: count)
  rescue ActiveRecord::RecordNotFound
    # The pass was replaced while this reviewer was running; its rows are gone.
    nil
  end

  private

  def persist(pass, findings)
    return 0 if findings.empty?

    WritingFinding.transaction do
      findings.each { |finding| WritingFinding.from_review(finding, pass:).save! }
    end
    DocumentMetaChannel.broadcast_event_after_commit(pass.document, :writing_pass)
    findings.size
  end
end
