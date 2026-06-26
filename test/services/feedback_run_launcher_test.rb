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

  class IncompleteClient
    def create_agent(_payload, idempotency_key:)
      { "agent" => { "id" => "bc-agent" }, "acceptedKey" => idempotency_key }
    end
  end

  class LeakyErrorClient
    def create_agent(_payload, idempotency_key:)
      raise Cursor::Client::Error.new(
        "Failed near https://example.com/feedback_runs/bundle/#{idempotency_key}",
        retryable: false
      )
    end
  end

  class TransactionCheckingClient
    attr_reader :opened_another_transaction

    def initialize(open_transactions:)
      @open_transactions = open_transactions
    end

    def create_agent(_payload, idempotency_key:)
      @opened_another_transaction = FeedbackRun.connection.open_transactions > @open_transactions
      {
        "agent" => { "id" => "bc-agent" },
        "run" => { "id" => "run-agent", "status" => "RUNNING", "key" => idempotency_key }
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

  test "an incomplete success response retains the attempt key" do
    run = feedback_run

    launch(run, IncompleteClient.new)

    assert_equal "failed", run.status
    assert run.idempotency_key.present?
    assert_equal 1, run.launch_attempt
    assert_includes run.error_message, "incomplete"
  end

  test "a launch error is redacted before persistence" do
    run = feedback_run

    launch(run, LeakyErrorClient.new)

    assert_equal "failed", run.status
    assert_includes run.error_message, "[private bundle URL]"
    refute_includes run.error_message, "/feedback_runs/bundle/"
  end

  test "Cursor is called outside the feedback row transaction" do
    run = feedback_run
    client = TransactionCheckingClient.new(
      open_transactions: FeedbackRun.connection.open_transactions
    )

    launch(run, client)

    assert_equal false, client.opened_another_transaction
    assert_equal "running", run.status
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
