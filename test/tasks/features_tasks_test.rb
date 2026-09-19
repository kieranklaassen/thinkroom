require "test_helper"
require "rake"

class FeaturesTasksTest < ActiveSupport::TestCase
  setup do
    Rake.application = Rake::Application.new
    Rails.application.load_tasks
    @user = User.create!(name: "Kieran", email: "task-features@example.com", password: "thoughtful-passphrase")
  end

  def run_task(name, *args)
    task = Rake::Task[name]
    task.reenable
    output = StringIO.new
    $stdout = output
    task.invoke(*args)
    output.string
  ensure
    $stdout = STDOUT
  end

  test "grant, list, and revoke" do
    assert_match(/Granted compound_writing to task-features@example.com/, run_task("features:grant", @user.email, "compound_writing"))
    assert @user.reload.feature?(:compound_writing)
    assert_match(/Already granted/, run_task("features:grant", @user.email.upcase, "compound_writing"))
    assert_match(/task-features@example.com/, run_task("features:list", "compound_writing"))
    assert_match(/Revoked compound_writing/, run_task("features:revoke", @user.email, "compound_writing"))
    assert_not @user.reload.feature?(:compound_writing)
  end

  test "an unknown email aborts" do
    error = assert_raises(SystemExit) { run_task("features:grant", "nobody@example.com", "compound_writing") }
    assert_not error.success?
  end
end
