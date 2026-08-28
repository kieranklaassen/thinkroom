require "test_helper"

# The WebMCP manifest rides as a lazy Inertia prop: present on full visits of
# the document page and the index, absent from partial reloads that do not ask
# for it (U4).
class WebmcpPropsTest < ActionDispatch::IntegrationTest
  DOCUMENT_TOOLS = %w[
    thinkroom_guide thinkroom_read_document thinkroom_propose_suggestion
    thinkroom_comment thinkroom_resolve_comment thinkroom_announce_presence
    thinkroom_poll_events thinkroom_ack_events thinkroom_create_document
  ].freeze
  # Present only when the viewer can write (R1): an edit link, or the owner.
  WRITABLE_TOOL = "thinkroom_update_document"
  INDEX_TOOLS = %w[thinkroom_guide thinkroom_create_document].freeze

  setup do
    @document = Document.create!(title: "Shared Doc", seed_markdown: "# Hello\n\nA paragraph.")
  end

  test "document page ships the writable manifest with share_url to a guest on an edit link" do
    get document_page_path(@document.slug), headers: browser

    assert_response :success
    assert_inertia_props do |props|
      manifest = props[:webmcp]
      manifest.present? &&
        manifest[:tools].map { |tool| tool[:name] }.sort == (DOCUMENT_TOOLS + [ WRITABLE_TOOL ]).sort &&
        manifest[:share_url].end_with?("/d/#{@document.slug}")
    end
  end

  test "a non-owner on a view link gets the manifest without the in-page update tool" do
    @document.update!(owner_token: "owner", owner_name: "Owner", claimed_at: Time.current, link_access: "view")
    reset!

    get document_page_path(@document.slug), headers: browser

    assert_response :success
    assert_inertia_props do |props|
      props[:ownership][:can_write] == false &&
        props[:webmcp][:tools].map { |tool| tool[:name] }.sort == DOCUMENT_TOOLS.sort
    end
  end

  test "the owner of a view-link document still gets the in-page update tool" do
    get document_page_path(@document.slug), headers: browser
    post claim_document_path(@document.slug), params: { name: "Owner" }, headers: browser
    @document.reload.update!(link_access: "view")

    get document_page_path(@document.slug), headers: browser

    assert_response :success
    assert_inertia_props do |props|
      props[:ownership][:can_write] == true &&
        props[:webmcp][:tools].map { |tool| tool[:name] }.sort == (DOCUMENT_TOOLS + [ WRITABLE_TOOL ]).sort
    end
  end

  test "index ships the index manifest" do
    get root_path, headers: browser

    assert_response :success
    assert_inertia_props do |props|
      names = props[:webmcp][:tools].map { |tool| tool[:name] }
      names.sort == INDEX_TOOLS.sort && !names.include?(WRITABLE_TOOL)
    end
  end

  test "partial reloads that do not ask for webmcp skip it" do
    get document_page_path(@document.slug), headers: browser.merge(
      "X-Inertia" => "true",
      "X-Inertia-Version" => InertiaController.safe_vite_digest.to_s,
      "X-Inertia-Partial-Component" => "documents/show",
      "X-Inertia-Partial-Data" => "suggestions"
    )

    assert_response :success
    assert_inertia_props do |props|
      props.key?(:suggestions) && !props.key?(:webmcp)
    end
  end

  private

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end
end
