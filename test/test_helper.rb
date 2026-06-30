ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require "inertia_rails/minitest"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # WriteRateLimited::STORE is a single in-memory cache shared by every test in a
    # parallel worker process; without a reset, write requests accumulate across
    # unrelated tests and can trip burst limits that no individual test approaches.
    setup { WriteRateLimited::STORE.clear }

    # Add more helper methods to be used by all tests here...
  end
end
