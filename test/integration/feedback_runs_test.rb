require "test_helper"

class FeedbackRunsTest < ActionDispatch::IntegrationTest
  class FakeCursorClient
    attr_reader :create_calls

    def initialize
      @create_calls = []
    end

    def create_agent(payload, idempotency_key:)
      @create_calls << { payload:, idempotency_key: }
      {
        "agent" => { "id" => "bc-agent", "url" => "https://cursor.com/agents/bc-agent" },
        "run" => { "id" => "run-1", "status" => "RUNNING" }
      }
    end

    def run(_agent_id, _run_id)
      {
        "id" => "run-1",
        "status" => "FINISHED",
        "result" => "Done. https://example.com/feedback_runs/bundle/private-token",
        "git" => {
          "branches" => [
            {
              "branch" => "cursor/riffrec-improvement",
              "prUrl" => "https://github.com/kieranklaassen/thinkroom/pull/123"
            }
          ]
        }
      }
    end
  end

  setup do
    @cursor_client = FakeCursorClient.new
    Rails.application.config.x.cursor_client = @cursor_client
  end

  teardown do
    Rails.application.config.x.cursor_client = nil
  end

  test "feedback upload requires a signed-in allowlisted account" do
    post feedback_runs_path, params: archive_params
    assert_response :unauthorized

    sign_in(email: "other@example.com")
    post feedback_runs_path, params: archive_params
    assert_response :forbidden
    assert_equal 0, FeedbackRun.count
  end

  test "valid feedback uploads privately and starts one idempotent Cursor run" do
    user = sign_in
    post feedback_runs_path, params: archive_params
    assert_response :created

    run = user.feedback_runs.sole
    assert run.archive.attached?
    assert_equal "running", run.status
    assert_equal "bc-agent", run.cursor_agent_id
    assert_equal "run-1", run.cursor_run_id
    assert_equal 1, run.launch_attempt
    assert_equal 1, @cursor_client.create_calls.length
    assert_equal true, @cursor_client.create_calls.first[:payload][:autoCreatePR]
    assert_equal "main", @cursor_client.create_calls.first[:payload][:repos].sole[:startingRef]
    assert_includes @cursor_client.create_calls.first[:payload].dig(:prompt, :text), "/ce-riffrec-feedback-analysis"
    assert_includes @cursor_client.create_calls.first[:payload].dig(:prompt, :text), "/lfg"
    refute_includes response.parsed_body.keys, "result_text"

    post feedback_runs_path, params: archive_params
    assert_response :ok
    assert_equal 1, FeedbackRun.count
    assert_equal 1, @cursor_client.create_calls.length
  end

  test "upload rejects a file that is not a Riffrec ZIP" do
    sign_in
    upload = Rack::Test::UploadedFile.new(StringIO.new("not a zip"), "application/zip",
                                          original_filename: "riffrec.zip")

    post feedback_runs_path, params: {
      archive: upload,
      filename: "riffrec.zip",
      session_id: "bad-session"
    }

    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "not a ZIP"
    assert_equal 0, FeedbackRun.count
  end

  test "upload rejects an empty archive and a wrong extension" do
    sign_in
    empty = Rack::Test::UploadedFile.new(StringIO.new(""), "application/zip",
                                         original_filename: "riffrec.zip")
    post feedback_runs_path, params: archive_params.merge(archive: empty)
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "empty"

    wrong_extension = Rack::Test::UploadedFile.new(
      StringIO.new("PK\x03\x04riffrec-data".b),
      "application/zip",
      original_filename: "riffrec.txt"
    )
    post feedback_runs_path, params: archive_params.merge(
      archive: wrong_extension,
      filename: "riffrec.txt"
    )
    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], ".zip"
    assert_equal 0, FeedbackRun.count
  end

  test "only the owner can read status and raw Cursor output stays server-side" do
    user = sign_in
    run = create_feedback_run(user)

    get feedback_run_path(run)

    assert_response :success
    assert_equal "finished", response.parsed_body["status"]
    assert_equal "https://github.com/kieranklaassen/thinkroom/pull/123", response.parsed_body["pr_url"]
    refute_includes response.parsed_body.keys, "result_text"
    assert_includes run.reload.result_text, "[private bundle URL]"
    refute_includes run.result_text, "private-token"

    delete logout_path
    sign_in(email: "maintainer2@example.com")
    get feedback_run_path(run)
    assert_response :not_found
  end

  test "a purpose-scoped bundle token redirects without exposing a permanent blob URL" do
    user = sign_in
    run = create_feedback_run(user)
    token = run.signed_id(expires_in: 1.hour, purpose: :feedback_bundle)

    delete logout_path
    get feedback_bundle_path(token:)

    assert_response :redirect
    assert_match %r{/rails/active_storage/}, response.location
  end

  test "a tampered bundle token is rejected" do
    get feedback_bundle_path(token: "tampered")
    assert_response :not_found
  end

  test "a signed bundle token with the wrong purpose is rejected" do
    user = sign_in
    run = create_feedback_run(user)
    token = run.signed_id(expires_in: 1.hour, purpose: :another_purpose)

    get feedback_bundle_path(token:)

    assert_response :not_found
  end

  private

  def sign_in(email: "maintainer@example.com")
    user = User.create!(name: "Feedback owner", email:, password: "thoughtful-passphrase")
    post login_path, params: { email:, password: "thoughtful-passphrase" }
    assert_response :see_other
    user
  end

  def create_feedback_run(user)
    post feedback_runs_path, params: archive_params
    assert_response :created
    user.feedback_runs.sole
  end

  def archive_params
    {
      archive: Rack::Test::UploadedFile.new(
        StringIO.new("PK\x03\x04riffrec-data".b),
        "application/zip",
        original_filename: "riffrec-test.zip"
      ),
      filename: "riffrec-test.zip",
      session_id: "session-123"
    }
  end
end
