require "test_helper"
require "open3"

# Runs the Node tests beside this file, so `bin/rails test` (and CI) covers them.
# Node runs the app's TypeScript directly, which needs 22.18 or newer.
class NodeSuiteTest < ActiveSupport::TestCase
  files = Dir[File.join(__dir__, "*.test.mjs")].sort

  test "there are frontend Node tests" do
    assert_not_empty files
  end

  # One run per file: a file that registers no test, or only skips them, exits 0.
  files.each do |file|
    test "#{File.basename(file)} passes and runs its tests" do
      output, status = Open3.capture2e(
        "node", "--test", "--test-timeout=60000", "--test-reporter=tap", file, chdir: Rails.root.to_s
      )

      assert status.success?, output
      # A floor: a test registered in a loop is declared once and runs more often.
      declared = File.read(file).scan(/^\s*test\(/).size
      assert_operator output[/^# pass (\d+)$/, 1].to_i, :>=, [ declared, 1 ].max, output
      assert_match(/^# skipped 0$/, output)
      assert_match(/^# todo 0$/, output)
      assert_no_match(/^\s*ok .*# (SKIP|TODO)/, output)
      # Node reports a file that registers no test as one passing test with the file's name.
      assert_no_match(/^ok \d+ - .*\.test\.mjs$/, output)
    end
  end
end
