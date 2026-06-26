class FeedbackRunSync
  TERMINAL_STATUSES = %w[FINISHED ERROR CANCELLED EXPIRED].freeze
  RESULT_LIMIT = 64.kilobytes

  def initialize(run, client: Cursor.client)
    @run = run
    @client = client
  end

  def call
    return @run if @run.terminal? || @run.cursor_agent_id.blank? || @run.cursor_run_id.blank?

    response = @client.run(@run.cursor_agent_id, @run.cursor_run_id)
    cursor_run = response["run"] || response
    status = cursor_run["status"].to_s.upcase
    attributes = {
      cursor_status: status,
      cursor_branch_name: git_value(cursor_run, "branch"),
      cursor_pr_url: git_value(cursor_run, "prUrl"),
      result_text: sanitize_result(cursor_run["result"])
    }.compact

    if status == "FINISHED"
      attributes.merge!(status: "finished", completed_at: Time.current, error_message: nil)
    elsif TERMINAL_STATUSES.include?(status)
      attributes.merge!(status: "failed", completed_at: Time.current,
                        error_message: cursor_run["error"].presence || "Cursor run ended with #{status.downcase}.")
    else
      attributes[:status] = "running"
    end

    @run.assign_attributes(attributes)
    @run.save! if @run.changed?
    @run
  rescue Cursor::Client::Error => error
    unless error.retryable
      @run.update!(status: "failed", completed_at: Time.current,
                   error_message: "Status refresh failed: #{error.message}")
    end
    @run
  end

  private

  def git_value(cursor_run, key)
    branches = cursor_run.dig("git", "branches")
    branches&.first&.[](key)
  end

  def sanitize_result(value)
    return if value.nil?

    text = value.is_a?(String) ? value : JSON.generate(value)
    text.gsub(%r{https?://[^\s]+/feedback_runs/bundle/[^\s]+}, "[private bundle URL]")
        .truncate(RESULT_LIMIT)
  rescue JSON::GeneratorError
    nil
  end
end
