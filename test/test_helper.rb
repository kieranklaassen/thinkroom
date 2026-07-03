ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require "inertia_rails/minitest"
require_relative "test_helpers/session_cookie_assertions"
require_relative "test_helpers/open_graph_helpers"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # WriteRateLimited::STORE is a single in-memory cache shared by every test in a
    # parallel worker process; without a reset, write requests accumulate across
    # unrelated tests and can trip burst limits that no individual test approaches.
    # SyncChannel::ACTIVE_SUBSCRIBERS leaks refcounts the same way: rolled-back
    # transactions reuse document ids, so a subscription left open by one test
    # would suppress another test's fold-on-last-disconnect.
    setup do
      WriteRateLimited::STORE.clear
      SyncChannel::ACTIVE_SUBSCRIBERS.clear
    end

    # Add more helper methods to be used by all tests here...
  end
end
