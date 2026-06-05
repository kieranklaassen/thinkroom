require "test_helper"

class SuggestionFlowTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    @document = Document.create!(title: "Doc")
    @suggestion = @document.suggestions.create!(
      author_name: "Gemini", author_kind: "ai", body: "New paragraph."
    )
  end

  test "accepting a pending suggestion marks it accepted and logs activity" do
    assert_difference -> { @document.activities.count }, 1 do
      patch accept_suggestion_path(@suggestion), params: { by: "Quiet Falcon" }
    end

    assert_redirected_to document_page_path(@document.slug)
    assert_equal "accepted", @suggestion.reload.status
    assert_equal "Quiet Falcon", @suggestion.resolved_by
    assert_equal "accepted_suggestion", @document.activities.last.action
  end

  test "accept broadcasts a suggestions event to connected editors" do
    assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 2) do
      # one :activities event from Activity.log!, one :suggestions event
      patch accept_suggestion_path(@suggestion)
    end
  end

  test "rejecting a pending suggestion discards it from the pending list" do
    patch reject_suggestion_path(@suggestion)
    assert_equal "rejected", @suggestion.reload.status
    assert_empty @document.suggestions.pending
  end

  test "resolving an already-resolved suggestion reports an error" do
    @suggestion.reject!
    patch accept_suggestion_path(@suggestion)
    assert_response :redirect
    assert_equal "rejected", @suggestion.reload.status
  end

  test "ask AI endpoint creates a pending ai suggestion" do
    original = ENV.delete("GEMINI_API_KEY")
    assert_difference -> { @document.suggestions.pending.count }, 1 do
      post document_ai_suggestions_path(@document.slug),
           params: { instruction: "expand the intro" },
           as: :json
    end
    assert_response :created
    suggestion = @document.suggestions.pending.last
    assert_equal "ai", suggestion.author_kind
    assert_equal "expand the intro", suggestion.intent
  ensure
    ENV["GEMINI_API_KEY"] = original if original
  end

  test "document show exposes pending suggestions as props" do
    get document_page_path(@document.slug)
    assert_response :success
    assert_includes response.body, "New paragraph."
  end
end
