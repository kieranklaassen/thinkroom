require "test_helper"

class DocumentArchiveTest < ActionDispatch::IntegrationTest
  test "owner archives a page out of Contents and Pinned and restores it" do
    get root_path
    post documents_path, params: { name: "Me" }
    document = Document.order(:created_at).last
    post document_pin_path(document.slug)

    patch document_archive_path(document.slug), params: { archived: true }
    assert_response :see_other
    assert document.reload.archived_at.present?

    get root_path
    assert_inertia_props do |props|
      props[:yours].none? { |row| row[:slug] == document.slug } &&
        props[:pinned].none? { |row| row[:slug] == document.slug } &&
        props[:yours_count].zero? &&
        props[:archived_count] == 1 &&
        !props.key?(:archived)
    end

    get root_path, headers: partial_headers("archived")
    assert_inertia_props do |props|
      props[:archived].map { |row| row[:slug] } == [ document.slug ]
    end

    patch document_archive_path(document.slug), params: { archived: false }
    assert_response :see_other
    assert_nil document.reload.archived_at
    get root_path
    assert_inertia_props do |props|
      props[:yours].any? { |row| row[:slug] == document.slug } &&
        props[:pinned].any? { |row| row[:slug] == document.slug } &&
        props[:archived_count].zero?
    end
  end

  test "an archived page still opens by link" do
    get root_path
    post documents_path, params: { name: "Me" }
    document = Document.order(:created_at).last
    patch document_archive_path(document.slug), params: { archived: true }

    get document_page_path(document.slug), headers: { "User-Agent" => "Mozilla/5.0" }
    assert_response :success
  end

  test "only the owner can archive" do
    document = Document.create!(title: "Someone else's", owner_token: "other", owner_name: "Other")
    get root_path

    patch document_archive_path(document.slug), params: { archived: true }

    assert_response :redirect
    assert_nil document.reload.archived_at
    assert_equal "Only the owner can archive this document", session[:inertia_errors]&.dig(:archive)
  end

  test "a missing page redirects home" do
    get root_path
    patch document_archive_path("missing"), params: { archived: true }
    assert_redirected_to root_path
  end

  private

  def partial_headers(data)
    {
      "X-Inertia" => "true",
      "X-Inertia-Version" => InertiaController.safe_vite_digest.to_s,
      "X-Inertia-Partial-Component" => "documents/index",
      "X-Inertia-Partial-Data" => data
    }
  end
end
