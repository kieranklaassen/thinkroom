require "test_helper"

class HomeDocumentsTest < ActiveSupport::TestCase
  include CompoundWritingHelpers

  TOKEN = "guest-browser"

  def home(user: nil, token: TOKEN, recent_slugs: [], now: Time.current.in_time_zone)
    HomeDocuments.new(user:, token:, recent_slugs:, now:)
  end

  def create_document(title, **attributes)
    Document.create!(title:, seed_content: "# #{title}", **attributes)
  end

  def titles(rows) = rows.map { |row| row[:title] }

  test "an account lists its own documents and a guest lists the browser's" do
    user = User.create!(name: "Owner", email: "home-owner@example.com", password: PASSWORD)
    create_document("Account", user:)
    create_document("Browser", owner_token: TOKEN)
    create_document("Nobody's")

    assert_equal [ "Account" ], titles(home(user:).yours)
    assert_equal [ "Browser" ], titles(home.yours)
    assert_equal 1, home(user:).yours_count
  end

  test "archived documents leave the list and are counted apart" do
    create_document("Current", owner_token: TOKEN)
    create_document("First away", owner_token: TOKEN, archived_at: 2.days.ago)
    create_document("Last away", owner_token: TOKEN, archived_at: 1.day.ago)

    lists = home
    assert_equal [ "Current" ], titles(lists.yours)
    assert_equal [ "Last away", "First away" ], titles(lists.archived)
    assert_equal [ 1, 2 ], [ lists.yours_count, lists.archived_count ]
  end

  test "recents keep the opened order and leave out owned and deleted documents" do
    first = create_document("First")
    mine = create_document("Mine", owner_token: TOKEN)
    last = create_document("Last", owner_token: "another-browser")

    lists = home(recent_slugs: [ "deleted", mine.slug, last.slug, first.slug ])
    assert_equal [ "Last", "First" ], titles(lists.recent)
    assert_equal [ false, true ], lists.recent.map { |row| row[:claimable] }
    assert_equal [ "Mine", true ], lists.continue_reading.values_at(:title, :yours)
    assert_nil home(recent_slugs: [ "deleted" ]).continue_reading
  end

  test "labels, the year and the week follow the zone of now" do
    create_document("New year", owner_token: TOKEN, created_at: Time.utc(2026, 1, 1, 3))
    now = Time.utc(2026, 1, 1, 12)

    utc = home(now: now.in_time_zone("UTC")).yours.sole
    assert_equal [ "Jan 1", "2026-01-01T03:00:00Z", "this_week" ], utc.values_at(:created_label, :created_at, :age_group)

    # Still 2025 in Los Angeles, where the viewer is already in 2026.
    west = home(now: Time.utc(2026, 1, 1, 20).in_time_zone("America/Los_Angeles")).yours.sole
    assert_equal [ "Dec 31, 2025", "2025-12-31T19:00:00-08:00" ], west.values_at(:created_label, :created_at)

    # Monday 00:00 starts the week in the viewer's zone.
    later = home(now: Time.utc(2026, 1, 5, 0, 30).in_time_zone("UTC")).yours.sole
    assert_equal "earlier", later[:age_group]
    still_sunday = home(now: Time.utc(2026, 1, 5, 0, 30).in_time_zone("America/Los_Angeles")).yours.sole
    assert_equal "this_week", still_sunday[:age_group]
  end

  test "both counts share a query, recents and continue reading share another" do
    document = create_document("Opened")

    # Uncached, or the query cache would hide a repeated query.
    Document.uncached do
      lists = nil
      assert_queries_count(0) { lists = home(recent_slugs: [ document.slug ]) }
      assert_queries_count(1) { [ lists.yours_count, lists.archived_count ] }
      assert_queries_count(1) { [ lists.recent, lists.continue_reading ] }
    end
  end
end
