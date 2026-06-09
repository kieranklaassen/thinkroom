require "test_helper"

class SuggestionTest < ActiveSupport::TestCase
  setup do
    @document = Document.create!(title: "Doc")
  end

  def build_suggestion(attrs = {})
    @document.suggestions.create!(
      { author_name: "Gemini", author_kind: "ai", body: "Proposed text." }.merge(attrs)
    )
  end

  test "valid with defaults" do
    suggestion = build_suggestion
    assert_equal "pending", suggestion.status
    assert suggestion.valid?
  end

  test "requires body and author_name" do
    suggestion = Suggestion.new(document: @document, author_kind: "ai")
    assert_not suggestion.valid?
    assert_includes suggestion.errors[:body], "can't be blank"
    assert_includes suggestion.errors[:author_name], "can't be blank"
  end

  test "author_kind restricted to ai, agent, or human" do
    suggestion = build_suggestion
    suggestion.author_kind = "robot"
    assert_not suggestion.valid?

    Suggestion::AUTHOR_KINDS.each do |kind|
      suggestion.author_kind = kind
      assert suggestion.valid?, "expected #{kind} to be a valid author_kind"
    end
  end

  test "accept! transitions pending to accepted and records resolver" do
    suggestion = build_suggestion
    suggestion.accept!(by: "Quiet Falcon")
    assert_equal "accepted", suggestion.reload.status
    assert_equal "Quiet Falcon", suggestion.resolved_by
  end

  test "reject! transitions pending to rejected" do
    suggestion = build_suggestion
    suggestion.reject!(by: "Quiet Falcon")
    assert_equal "rejected", suggestion.reload.status
  end

  test "transitions from a resolved state raise" do
    suggestion = build_suggestion
    suggestion.reject!
    assert_raises(ActiveRecord::RecordInvalid) { suggestion.accept! }
    assert_equal "rejected", suggestion.reload.status
  end

  test "pending scope excludes resolved suggestions" do
    pending = build_suggestion
    build_suggestion.accept!
    assert_equal [ pending.id ], @document.suggestions.pending.pluck(:id)
  end

  test "as_props exposes the client contract" do
    props = build_suggestion(intent: "Tighten intro", anchor_text: "anchor").as_props
    assert_equal %w[id author_name author_kind intent body anchor_text replaces status created_at].sort,
                 props.keys.map(&:to_s).sort
  end

  test "HTML proposals are sanitized and report normalization" do
    document = Document.create!(title: "HTML", content_format: "html")

    suggestion = Suggestion.propose!(
      document:,
      author_name: "Scout",
      author_kind: "agent",
      body: '<p onclick="bad()">Hello <span data-provenance data-kind="human" data-state="endorsed">world</span></p>'
    )

    assert suggestion.normalization_changed
    assert_includes suggestion.body, "<p>Hello"
    refute_match(/onclick|data-provenance|data-kind|data-state/, suggestion.body)
  end
end
