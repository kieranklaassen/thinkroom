require "test_helper"

class DocumentIndexTest < ActionDispatch::IntegrationTest
  def establish_identity
    get root_path
    assert_response :success
  end

  test "index serializes stable date groups and tags for owned and recent documents" do
    establish_identity
    week_start = Time.current.beginning_of_week
    this_week = Document.create!(
      title: "This week",
      created_at: week_start + 1.hour,
      tags: [ "Research" ]
    )
    earlier = Document.create!(
      title: "Earlier",
      created_at: week_start - 1.second,
      tags: [ "Archive" ]
    )
    recent = Document.create!(
      title: "Recent",
      created_at: week_start - 2.days,
      tags: [ "Shared" ]
    )
    post claim_document_path(this_week.slug), params: { name: "Me" }
    post claim_document_path(earlier.slug), params: { name: "Me" }
    get document_page_path(recent.slug), headers: { "User-Agent" => "Mozilla/5.0" }

    get root_path
    assert_inertia_props do |props|
      week_row = props[:yours].find { |row| row[:slug] == this_week.slug }
      earlier_row = props[:yours].find { |row| row[:slug] == earlier.slug }
      recent_row = props[:recent].find { |row| row[:slug] == recent.slug }

      week_row[:age_group] == "this_week" &&
        week_row[:tags] == [ "Research" ] &&
        week_row[:created_at] == this_week.created_at.iso8601 &&
        week_row[:created_label] == this_week.created_at.strftime("%b %-d") &&
        earlier_row[:age_group] == "earlier" &&
        recent_row[:age_group] == "earlier" &&
        recent_row[:tags] == [ "Shared" ] &&
        recent_row[:claimable] == true
    end
  end

  test "guest owner can replace and clear tags" do
    establish_identity
    post documents_path, params: { name: "Guest owner" }
    document = Document.order(:created_at).last

    patch document_tags_path(document.slug), params: {
      tags: [ " Product   Strategy ", "Research" ]
    }
    assert_response :see_other
    assert_equal [ "Product Strategy", "Research" ], document.reload.tags

    patch document_tags_path(document.slug), params: { tags: [] }
    assert_response :see_other
    assert_equal [], document.reload.tags
  end

  test "signed in owner can replace tags" do
    user = create_and_sign_in_user
    document = Document.create!(title: "Account doc", user:, owner_name: user.name)

    patch document_tags_path(document.slug), params: { tags: [ "Planning" ] }

    assert_response :see_other
    assert_equal [ "Planning" ], document.reload.tags
  end

  test "non owner cannot change tags" do
    document = Document.create!(
      title: "Someone else's",
      owner_token: "another-browser",
      owner_name: "Other",
      tags: [ "Original" ]
    )
    establish_identity

    patch document_tags_path(document.slug),
          params: { tags: [ "Changed" ] },
          headers: inertia_headers

    assert_response :see_other
    assert_equal [ "Original" ], document.reload.tags
  end

  test "invalid tag input leaves persisted tags unchanged" do
    establish_identity
    post documents_path, params: { name: "Guest owner" }
    document = Document.order(:created_at).last
    document.update!(tags: [ "Original" ])

    patch document_tags_path(document.slug),
          params: { tags: Array.new(Document::MAX_TAGS + 1) { |index| "tag-#{index}" } },
          headers: inertia_headers

    assert_response :see_other
    assert_equal [ "Original" ], document.reload.tags
    get root_path, headers: inertia_headers
    assert_inertia_props do |props|
      props.dig(:errors, :tags) == "can include at most 8 tags"
    end
  end

  test "tag endpoint rejects non list input and redirects missing documents safely" do
    establish_identity
    post documents_path, params: { name: "Guest owner" }
    document = Document.order(:created_at).last

    patch document_tags_path(document.slug),
          params: { tags: "not-a-list" },
          headers: inertia_headers
    assert_response :see_other
    assert_equal [], document.reload.tags

    patch document_tags_path("missing"), params: { tags: [ "Ignored" ] }
    assert_redirected_to root_path
  end

  private

  def inertia_headers
    {
      "X-Inertia" => "true",
      "X-Inertia-Partial-Component" => "documents/index",
      "X-Inertia-Partial-Data" => "yours,recent,errors"
    }
  end

  def create_and_sign_in_user
    user = User.create!(
      name: "Account owner",
      email: "owner@example.com",
      password: "thoughtful-passphrase"
    )
    post login_path, params: { email: user.email, password: "thoughtful-passphrase" }
    assert_response :see_other
    user
  end
end
