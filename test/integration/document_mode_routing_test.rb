require "test_helper"

class DocumentModeRoutingTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Addressable modes", seed_markdown: "# Addressable modes")
  end

  test "canonical document URL renders Read mode even with a stale mode cookie" do
    cookies[:pruf_mode] = "suggest"

    get document_page_path(@document.slug), headers: browser

    assert_response :ok
    assert_inertia_props { |props| props.dig(:ui, :mode) == "read" }
  end

  test "explicit mode URLs render their matching mode" do
    %w[edit suggest comment].each do |mode|
      get document_mode_path(@document.slug, mode), headers: browser

      assert_response :ok
      assert_inertia_props { |props| props.dig(:ui, :mode) == mode }
    end
  end

  test "unknown mode URLs do not route to the document page" do
    get "/d/#{@document.slug}/review", headers: browser

    assert_response :not_found
  end

  test "locked owner can open an explicit mode but another viewer is redirected to Read" do
    get root_path
    post claim_document_path(@document.slug), params: { name: "Owner" }
    patch document_editing_lock_path(@document.slug), params: { locked: true }

    get document_mode_path(@document.slug, "suggest"), headers: browser
    assert_response :ok
    assert_inertia_props { |props| props.dig(:ui, :mode) == "suggest" }

    other = open_session
    other.get document_mode_path(@document.slug, "edit"), headers: browser
    assert_equal 303, other.response.status
    assert_equal document_page_path(@document.slug), URI(other.response.location).path
  end

  test "unavailable mode redirect does not claim a pending document seed" do
    @document.update!(
      owner_token: "someone-else",
      owner_name: "Owner",
      claimed_at: Time.current,
      editing_locked: true
    )

    get document_mode_path(@document.slug, "comment"), headers: browser

    assert_response :see_other
    assert_redirected_to document_page_path(@document.slug)
    assert_equal "pending", @document.reload.seed_state
  end

  test "demo keeps its established URL locked to Edit" do
    demo = Document.create!(title: "Demo", slug: "demo")

    get document_page_path(demo.slug), headers: browser
    assert_response :ok
    assert_inertia_props { |props| props.dig(:ui, :mode) == "edit" }

    get document_mode_path(demo.slug, "suggest"), headers: browser
    assert_response :see_other
    assert_redirected_to document_page_path(demo.slug)
  end

  private

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end
end
