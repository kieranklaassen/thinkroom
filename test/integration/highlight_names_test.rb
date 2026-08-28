require "test_helper"

class HighlightNamesTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    @document = Document.create!(title: "Doc")
  end

  test "writer names a color and every rail reloads via broadcast" do
    assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 1) do
      patch document_highlight_names_path(@document.slug),
            params: { names: { yellow: "Urgent" } }, as: :json
    end

    assert_response :no_content
    assert_equal({ "yellow" => "Urgent" }, @document.reload.highlight_names)
  end

  test "renames merge and blank names clear their entry" do
    @document.update!(highlight_names: { "yellow" => "Urgent", "green" => "Done" })

    patch document_highlight_names_path(@document.slug),
          params: { names: { yellow: "Later", green: "" } }, as: :json

    assert_response :no_content
    assert_equal({ "yellow" => "Later" }, @document.reload.highlight_names)
  end

  test "names are squished and capped at 64 characters" do
    patch document_highlight_names_path(@document.slug),
          params: { names: { blue: "  Follow   up #{'x' * 100}" } }, as: :json

    assert_response :no_content
    name = @document.reload.highlight_names["blue"]
    assert_equal 64, name.length
    assert name.start_with?("Follow up x")
  end

  test "unknown colors and non-hash payloads are rejected" do
    patch document_highlight_names_path(@document.slug),
          params: { names: { chartreuse: "Nope" } }, as: :json
    assert_response :unprocessable_entity

    patch document_highlight_names_path(@document.slug),
          params: { names: "Nope" }, as: :json
    assert_response :unprocessable_entity

    assert_equal({}, @document.reload.highlight_names)
  end

  test "view-only non-owner cannot name colors" do
    @document.update!(
      owner_token: "someone-else",
      owner_name: "Owner",
      link_access: "view"
    )

    patch document_highlight_names_path(@document.slug),
          params: { names: { yellow: "Forbidden" } }, as: :json

    assert_response :locked
    assert_equal({}, @document.reload.highlight_names)
  end

  test "show ships highlight names as a prop" do
    @document.update!(highlight_names: { "yellow" => "Urgent" })

    get document_page_path(@document.slug), headers: { "User-Agent" => "Mozilla/5.0" }

    assert_response :success
    assert_inertia_props do |props|
      props[:highlight_names] == { yellow: "Urgent" } ||
        props[:highlight_names] == { "yellow" => "Urgent" }
    end
  end
end
