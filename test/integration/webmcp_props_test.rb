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
  INDEX_TOOLS = %w[thinkroom_guide thinkroom_create_document].freeze

  setup do
    @document = Document.create!(title: "Shared Doc", seed_markdown: "# Hello\n\nA paragraph.")
  end

  test "document page ships the document manifest with share_url" do
    get document_page_path(@document.slug), headers: browser

    assert_response :success
    assert_inertia_props do |props|
      manifest = props[:webmcp]
      manifest.present? &&
        manifest[:tools].map { |tool| tool[:name] }.sort == DOCUMENT_TOOLS.sort &&
        manifest[:share_url].end_with?("/d/#{@document.slug}")
    end
  end

  test "index ships the index manifest" do
    get root_path, headers: browser

    assert_response :success
    assert_inertia_props do |props|
      props[:webmcp][:tools].map { |tool| tool[:name] }.sort == INDEX_TOOLS.sort
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
