require "test_helper"

class DocumentUiPreferencesTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Preferences", seed_markdown: "# Preferences")
  end

  test "document width preference is exposed for first paint" do
    cookies[:pruf_width] = "864"

    get document_page_path(@document.slug), headers: browser

    assert_inertia_props { |props| props.dig(:ui, :document_width) == 864 }
  end

  test "document width preference is clamped to safe bounds" do
    cookies[:pruf_width] = "20"
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props { |props| props.dig(:ui, :document_width) == 576 }

    cookies[:pruf_width] = "9000"
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props { |props| props.dig(:ui, :document_width) == 1120 }
  end

  test "invalid document width preference uses the theme default" do
    cookies[:pruf_width] = "default"

    get document_page_path(@document.slug), headers: browser

    assert_inertia_props { |props| props.dig(:ui, :document_width).nil? }
  end

  test "rich content width preference is exposed and clamped independently" do
    cookies[:pruf_width] = "704"
    cookies[:pruf_rich_width] = "1088"
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props do |props|
      props.dig(:ui, :document_width) == 704 && props.dig(:ui, :rich_content_width) == 1088
    end

    cookies[:pruf_rich_width] = "20"
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props { |props| props.dig(:ui, :rich_content_width) == 640 }

    cookies[:pruf_rich_width] = "9000"
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props { |props| props.dig(:ui, :rich_content_width) == 1200 }
  end

  test "invalid rich content width uses the responsive default" do
    cookies[:pruf_rich_width] = "default"

    get document_page_path(@document.slug), headers: browser

    assert_inertia_props { |props| props.dig(:ui, :rich_content_width).nil? }
  end

  private

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end
end
