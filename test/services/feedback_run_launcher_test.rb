require "test_helper"

class FeedbackRunLauncherTest < ActiveSupport::TestCase
  class RetryOnceClient
    attr_reader :keys

    def initialize(retryable:)
      @retryable = retryable
      @keys = []
    end

    def create_agent(_payload, idempotency_key:)
      @keys << idempotency_key
      if @keys.one?
        raise Cursor::Client::Error.new("temporary failure", retryable: @retryable)
      end

      {
        "agent" => { "id" => "bc-agent" },
        "run" => { "id" => "run-agent", "status" => "RUNNING" }
      }
    end
  end

  test "a retryable launch reuses the same idempotency key" do
    run = feedback_run
    client = RetryOnceClient.new(retryable: true)

    launch(run, client)
    assert_equal "failed", run.status
    first_key = run.idempotency_key

    launch(run, client)
    assert_equal "running", run.status
    assert_equal [ first_key, first_key ], client.keys
    assert_equal 1, run.launch_attempt
  end

  test "a definitive launch failure creates a fresh attempt on retry" do
    run = feedback_run
    client = RetryOnceClient.new(retryable: false)

    launch(run, client)
    assert_nil run.idempotency_key

    launch(run, client)
    assert_equal "running", run.status
    assert_equal 2, client.keys.uniq.length
    assert_equal 2, run.launch_attempt
  end

  private

  def launch(run, client)
    FeedbackRunLauncher.new(run, bundle_url: "https://example.com/private-bundle", client:).call
  end

  def feedback_run
    user = User.create!(name: "Owner", email: "launcher@example.com",
                        password: "thoughtful-passphrase")
    user.feedback_runs.create!(client_session_id: SecureRandom.uuid)
  end
end
