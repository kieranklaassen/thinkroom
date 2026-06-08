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
    # The errors bag must actually survive to the follow-up render — staging
    # is silently discarded by the middleware when the redirect is 303.
    assert_equal "is no longer pending", session[:inertia_errors][:suggestion]
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
    get document_page_path(@document.slug), headers: { "User-Agent" => "Mozilla/5.0" }
    assert_response :success
    assert_inertia_component "documents/show"
    assert_inertia_props do |props|
      props[:suggestions].any? { |s| s[:body] == "New paragraph." }
    end
  end

  # --- U4: browser-facing suggest-a-change (Suggest mode) ---

  test "browser POST creates a pending human suggestion with activity and broadcast" do
    assert_difference -> { @document.suggestions.pending.count }, 1 do
      assert_broadcasts(DocumentMetaChannel.broadcasting_for(@document), 2) do
        # one :activities event from Activity.log!, one :suggestions event
        post document_suggestions_path(@document.slug), params: {
          author_name: "Quiet Falcon",
          body: "Tighter phrasing.",
          anchor_text: "Original sentence.",
          replaces: "Original sentence.",
          intent: "tighten"
        }
      end
    end

    assert_response :see_other
    suggestion = @document.suggestions.pending.last
    assert_equal "human", suggestion.author_kind
    assert_equal "Quiet Falcon", suggestion.author_name
    assert_equal "Tighter phrasing.", suggestion.body
    assert_equal "suggested", @document.activities.last.action
  end

  test "browser POST ignores a client-posted author_kind — always human" do
    post document_suggestions_path(@document.slug), params: {
      author_name: "Sneaky", author_kind: "agent", body: "text"
    }
    assert_equal "human", @document.suggestions.last.author_kind
  end

  test "session display name wins over a client-posted author name" do
    post identity_path, params: { name: "Session Name" }

    post document_suggestions_path(@document.slug), params: {
      author_name: "Posted Name", body: "text"
    }
    assert_equal "Session Name", @document.suggestions.last.author_name
  end

  test "missing author name falls back to Anonymous" do
    post document_suggestions_path(@document.slug), params: { body: "text" }
    assert_equal "Anonymous", @document.suggestions.last.author_name
  end

  test "oversized body is rejected with a validation error and no record" do
    assert_no_difference -> { @document.suggestions.count } do
      post document_suggestions_path(@document.slug), params: {
        body: "a" * (Suggestion::MAX_BODY_BYTES + 1)
      }
    end
    # 302, not 303: error-bag redirects carry no explicit status so the
    # InertiaRails middleware preserves the staged errors (it only keeps
    # them across 301/302 and upgrades Inertia non-GET redirects itself).
    assert_response :redirect
    assert_includes session[:inertia_errors][:suggestion], "Body is too long"
  end

  test "oversized replaces and anchor_text are rejected" do
    assert_no_difference -> { @document.suggestions.count } do
      post document_suggestions_path(@document.slug), params: {
        body: "ok", replaces: "a" * (Suggestion::MAX_BODY_BYTES + 1)
      }
      post document_suggestions_path(@document.slug), params: {
        body: "ok", anchor_text: "a" * (Suggestion::MAX_ANCHOR_BYTES + 1)
      }
    end
  end

  test "oversized intent is rejected" do
    assert_no_difference -> { @document.suggestions.count } do
      post document_suggestions_path(@document.slug), params: {
        body: "ok", intent: "a" * (Suggestion::MAX_INTENT_BYTES + 1)
      }
    end
  end

  test "empty body is rejected" do
    assert_no_difference -> { @document.suggestions.count } do
      post document_suggestions_path(@document.slug), params: { body: "" }
    end
    assert_response :redirect
  end

  test "browser POST to an unknown doc redirects home without a 500" do
    post document_suggestions_path("gone-doc"), params: { body: "text" }
    assert_redirected_to root_path
  end

  test "a human-authored suggestion flows through the same accept machinery" do
    suggestion = Suggestion.propose!(
      document: @document, author_name: "Quiet Falcon", author_kind: "human",
      body: "Better wording.", replaces: "Old wording."
    )

    patch accept_suggestion_path(suggestion), params: { by: "Reviewer" }
    assert_equal "accepted", suggestion.reload.status
    assert_includes @document.activities.last.detail, "Quiet Falcon"
  end
end
