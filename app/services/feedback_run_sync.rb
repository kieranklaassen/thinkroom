class FeedbackRunSync
  TERMINAL_STATUSES = %w[FINISHED ERROR CANCELLED EXPIRED].freeze

  def initialize(run, client: Cursor.client)
    @run = run
    @client = client
  end

  def call
    return @run if @run.terminal? || @run.cursor_agent_id.blank? || @run.cursor_run_id.blank?

    response = @client.run(@run.cursor_agent_id, @run.cursor_run_id)
    cursor_run = response["run"] || response
    raise Cursor::Client::Error.new("Cursor returned an incomplete status response.", retryable: true) unless cursor_run.is_a?(Hash)

    status = cursor_run["status"].to_s.upcase
    raise Cursor::Client::Error.new("Cursor returned an incomplete status response.", retryable: true) if status.blank?

    attributes = {
      cursor_status: status,
      cursor_branch_name: git_value(cursor_run, "branch"),
      cursor_pr_url: git_value(cursor_run, "prUrl"),
      result_text: FeedbackOutputSanitizer.result(cursor_run["result"])
    }.compact.merge(error_message: nil)

    if status == "FINISHED"
      attributes.merge!(status: "finished", completed_at: Time.current, error_message: nil)
    elsif TERMINAL_STATUSES.include?(status)
      attributes.merge!(status: "failed", completed_at: Time.current,
                        error_message: FeedbackOutputSanitizer.error(
                          cursor_run["error"].presence || "Cursor run ended with #{status.downcase}."
                        ))
    else
      attributes[:status] = "running"
    end

    @run.assign_attributes(attributes)
    @run.save! if @run.changed?
    @run
  rescue Cursor::Client::Error => error
    if error.retryable
      @run.update!(error_message: "Cursor status is temporarily unavailable.")
    else
      @run.update!(status: "failed", completed_at: Time.current,
                   error_message: FeedbackOutputSanitizer.error("Status refresh failed: #{error.message}"))
    end
    @run
  end

  private

  def git_value(cursor_run, key)
    branches = cursor_run.dig("git", "branches")
    return unless branches.is_a?(Array) && branches.first.is_a?(Hash)

    branches.first[key]
  end
end
