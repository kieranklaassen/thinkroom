require "test_helper"
require_relative "own_process_helpers"

class OwnProcessHelpersTest < ActiveSupport::TestCase
  include OwnProcessHelpers

  test "a hung process fails in the limit and leaves nothing behind" do
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    failure = assert_raises(Minitest::Assertion) do
      run_in_own_process("sh", "-c", "sleep 120 & echo pids $$ $!; wait", limit: 2)
    end
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 15
    assert_match(/\AStill running after 2 seconds, so it was killed\./, failure.message)

    pid, child = failure.message.match(/^pids (\d+) (\d+)$/).captures.map(&:to_i)
    assert_raises(Errno::ECHILD) { Process.wait(pid) }
    assert_gone pid
    assert_gone child
  end

  test "a hung Rails script fails in the limit" do
    failure = assert_raises(Minitest::Assertion) { run_in_own_rails("sleep 120", limit: 1) }
    assert_match(/\AStill running after 1 seconds/, failure.message)
  end

  test "a process that ends with an error fails with what it reported" do
    failure = assert_raises(Minitest::Assertion) { run_in_own_process("sh", "-c", "echo broken >&2; exit 3") }
    assert_includes failure.message, "broken"
  end

  test "a process gets its input and returns what it printed, without its errors" do
    assert_equal "words", run_in_own_process("sh", "-c", "echo noise >&2; cat", stdin_data: "words")
  end

  private

  # The system reaps an orphan on its own time.
  def assert_gone(pid)
    200.times do
      Process.kill(0, pid)
      sleep 0.05
    end
    flunk "Process #{pid} is still there"
  rescue Errno::ESRCH
    pass
  end
end
