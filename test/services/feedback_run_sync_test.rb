require "test_helper"

class FeedbackRunSyncTest < ActiveSupport::TestCase
  class FakeClient
    def initialize(response: nil, error: nil)
      @response = response
      @error = error
    end

    def run(_agent_id, _run_id)
      raise @error if @error

      @response
    end
  end

  test "a retryable refresh failure preserves running state and exposes safe backoff copy" do
    run = feedback_run(error_message: nil)
    error = Cursor::Client::Error.new("rate limited", retryable: true)

    FeedbackRunSync.new(run, client: FakeClient.new(error:)).call

    assert_equal "running", run.status
    assert_equal "Cursor status is temporarily unavailable.", run.error_message
  end

  test "the next successful refresh clears a transient error" do
    run = feedback_run(error_message: "Cursor status is temporarily unavailable.")

    FeedbackRunSync.new(
      run,
      client: FakeClient.new(response: { "status" => "RUNNING" })
    ).call

    assert_equal "running", run.status
    assert_nil run.error_message
  end

  test "a missing status is handled as a retryable refresh failure" do
    run = feedback_run

    FeedbackRunSync.new(run, client: FakeClient.new(response: {})).call

    assert_equal "running", run.status
    assert_equal "Cursor status is temporarily unavailable.", run.error_message
  end

  test "terminal errors and bundle URLs are bounded and redacted" do
    run = feedback_run
    cursor_error = {
      "detail" => "See https://example.com/feedback_runs/bundle/private-token #{"x" * 1_000}"
    }

    FeedbackRunSync.new(
      run,
      client: FakeClient.new(response: { "status" => "ERROR", "error" => cursor_error })
    ).call

    assert_equal "failed", run.status
    assert run.completed_at.present?
    assert_includes run.error_message, "[private bundle URL]"
    refute_includes run.error_message, "private-token"
    assert_operator run.error_message.length, :<=, FeedbackOutputSanitizer::ERROR_LIMIT
  end

  private

  def feedback_run(error_message: nil)
    user = User.create!(name: "Owner", email: "sync-#{SecureRandom.hex(4)}@example.com",
                        password: "thoughtful-passphrase")
    user.feedback_runs.create!(
      client_session_id: SecureRandom.uuid,
      status: "running",
      cursor_agent_id: "bc-agent",
      cursor_run_id: "run-agent",
      cursor_status: "RUNNING",
      error_message:
    )
  end
end
