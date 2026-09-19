require "test_helper"
require "rake"

class FlagsTasksTest < ActiveSupport::TestCase
  setup do
    Rake.application = Rake::Application.new
    Rails.application.load_tasks
    @user = User.create!(name: "Kieran", email: "task-flags@example.com", password: "thoughtful-passphrase")
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

  test "flags:enable and flags:disable target one account; flags:list shows them" do
    assert_match(/Enabled compound_writing for task-flags@example.com/, run_task("flags:enable", "compound_writing", @user.email.upcase))
    assert Flipper.enabled?(:compound_writing, @user)
    assert CompoundWriting.available_to?(@user)
    assert_match(/task-flags@example.com/, run_task("flags:list", "compound_writing"))
    assert_match(/Disabled compound_writing for task-flags@example.com/, run_task("flags:disable", "compound_writing", @user.email))
    assert_not Flipper.enabled?(:compound_writing, @user)
  end

  test "unknown flags and emails abort" do
    assert_raises(SystemExit) { run_task("flags:enable", "teleport", @user.email) }
    assert_raises(SystemExit) { run_task("flags:enable", "compound_writing", "nobody@example.com") }
  end

  test "admin:grant, admin:list, and admin:revoke" do
    assert_match(/is an admin/, run_task("admin:grant", @user.email))
    assert @user.reload.admin?
    assert_match(/task-flags@example.com/, run_task("admin:list"))
    assert_match(/no longer an admin/, run_task("admin:revoke", @user.email))
    assert_not @user.reload.admin?
  end
end
