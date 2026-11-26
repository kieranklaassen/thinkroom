require "test_helper"
require "open3"

# Runs the Node tests beside this file, so `bin/rails test` (and CI) covers them.
# Node runs the app's TypeScript directly, which needs 22.18 or newer.
class NodeSuiteTest < ActiveSupport::TestCase
  test "frontend Node tests pass" do
    files = Dir[Rails.root.join("test/frontend/*.test.mjs").to_s].sort
    assert_not_empty files

    output, status = Open3.capture2e(
      "node", "--test", "--test-timeout=60000", "--test-reporter=tap", *files, chdir: Rails.root.to_s
    )

    assert status.success?, output
    # A run that executes nothing also exits 0.
    assert_operator output[/^# pass (\d+)$/, 1].to_i, :>=, files.size, output
    assert_match(/^# skipped 0$/, output)
    assert_match(/^# todo 0$/, output)
    # Node reports a file that registers no test as one passing test with the file's name.
    assert_no_match(/^ok \d+ - .*\.test\.mjs$/, output)
  end
end
