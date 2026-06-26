require "test_helper"

class FeedbackRunTest < ActiveSupport::TestCase
  test "client session IDs are unique per user" do
    user = User.create!(name: "Owner", email: "feedback@example.com",
                        password: "thoughtful-passphrase")
    user.feedback_runs.create!(client_session_id: "session-1")
    duplicate = user.feedback_runs.new(client_session_id: "session-1")

    assert_not duplicate.valid?
    assert_includes duplicate.errors[:client_session_id], "has already been taken"
  end

  test "public status excludes private result text and identifiers" do
    run = FeedbackRun.new(
      id: 12,
      status: "finished",
      cursor_agent_id: "private-agent-id",
      cursor_run_id: "private-run-id",
      result_text: "private raw Cursor output",
      cursor_pr_url: "https://github.com/example/repo/pull/1"
    )

    assert_equal({ id: 12, status: "finished", pr_url: "https://github.com/example/repo/pull/1" },
                 run.public_status)
  end
end
