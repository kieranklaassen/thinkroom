require "tempfile"

# Runs a script in a process of its own, under a time limit: a process that
# hangs is killed with everything it started, and its test fails.
module OwnProcessHelpers
  OWN_PROCESS_LIMIT = 60 # seconds, with room for a slow boot on a busy machine

  private

  def run_in_own_rails(script, stdin_data: "", limit: OWN_PROCESS_LIMIT)
    run_in_own_process(Rails.root.join("bin/rails").to_s, "runner", script, stdin_data:, limit:)
  end

  def run_in_own_process(*command, stdin_data: "", limit: OWN_PROCESS_LIMIT)
    # Files, not pipes: reading them never waits for a process that holds one open.
    stdin, stdout, stderr = %w[stdin stdout stderr].map { |name| Tempfile.new(name) }
    stdin.write(stdin_data)
    stdin.rewind

    pid = Process.spawn({ "RAILS_ENV" => "test" }, *command, in: stdin, out: stdout, err: stderr, pgroup: true)
    waiter = Process.detach(pid)
    finished = waiter.join(limit)
    kill_process_group(waiter) unless finished

    printed, errors = [ stdout, stderr ].map { |file| file.tap(&:rewind).read }
    assert finished, "Still running after #{limit} seconds, so it was killed. It printed:\n#{printed}#{errors}"
    assert waiter.value.success?, errors
    printed
  ensure
    # An interrupted wait must not leave the process either.
    kill_process_group(waiter) if waiter&.alive?
    [ stdin, stdout, stderr ].compact.each(&:close!)
  end

  def kill_process_group(waiter)
    Process.kill(:KILL, -waiter.pid)
  rescue Errno::ESRCH, Errno::EPERM
    # It ended by itself in the meantime; macOS answers EPERM until it is reaped.
  ensure
    waiter.join
  end
end
