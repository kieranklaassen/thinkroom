require "test_helper"

class GeminiSuggesterTest < ActiveSupport::TestCase
  setup do
    @document = Document.create!(title: "Doc", content_markdown: "# Hello")
  end

  test "without an API key creates a canned pending suggestion" do
    suggestion = nil
    ClimateControl_modify_or_skip do
      suggestion = GeminiSuggester.call(document: @document, instruction: "improve")
    end

    assert suggestion.persisted?
    assert_equal "pending", suggestion.status
    assert_equal "ai", suggestion.author_kind
    assert_equal "Gemini", suggestion.author_name
    assert_includes GeminiSuggester::CANNED, suggestion.body
  end

  test "logs an activity and uses the instruction as intent" do
    assert_difference -> { @document.activities.count }, 1 do
      GeminiSuggester.call(document: @document, instruction: "add a summary")
    end
    activity = @document.activities.last
    assert_equal "suggested", activity.action
    assert_equal "agent", Suggestion::AUTHOR_KINDS.last
    assert_equal "add a summary", @document.suggestions.last.intent
  end

  test "uses generated text when the model responds" do
    original = GeminiSuggester.method(:generate)
    GeminiSuggester.define_singleton_method(:generate) { |**| "A generated passage." }
    suggestion = GeminiSuggester.call(document: @document)
    assert_equal "A generated passage.", suggestion.body
  ensure
    GeminiSuggester.define_singleton_method(:generate, original)
  end

  test "agent attribution flows through author fields" do
    suggestion = GeminiSuggester.call(
      document: @document,
      author_name: "Scout",
      author_kind: "agent",
      instruction: "rewrite"
    )
    assert_equal "Scout", suggestion.author_name
    assert_equal "agent", suggestion.author_kind
  end

  private

  # The suite must not depend on the developer's shell env: force-blank the key.
  def ClimateControl_modify_or_skip(&block)
    original = ENV.delete("GEMINI_API_KEY")
    yield
  ensure
    ENV["GEMINI_API_KEY"] = original if original
  end
end
