require "test_helper"

class DocumentTest < ActiveSupport::TestCase
  test "content format defaults to markdown" do
    assert_equal "markdown", Document.create!(title: "Default").content_format
  end

  test "content format accepts html and cannot change after creation" do
    doc = Document.create!(title: "HTML", content_format: "html")

    assert doc.html?
    assert_equal Document::DEFAULT_HTML_SEED, doc.default_seed
    assert_raises(ActiveRecord::ReadonlyAttributeError) do
      doc.update!(content_format: "markdown")
    end
    assert_equal "html", doc.reload.content_format
  end

  test "content format rejects unknown values" do
    doc = Document.new(title: "Unknown", content_format: "xml")

    assert_not doc.valid?
    assert doc.errors[:content_format].present?
  end

  test "format-neutral source accessors use existing columns" do
    doc = Document.new(seed_content: "<p>Seed</p>", content_snapshot: "<p>Snapshot</p>")

    assert_equal "<p>Seed</p>", doc.seed_markdown
    assert_equal "<p>Snapshot</p>", doc.content_markdown
  end

  test "an empty snapshot remains authoritative for markdown and HTML" do
    markdown = Document.new(seed_content: "# Seed", content_snapshot: "")
    html = Document.new(content_format: "html", seed_content: "<p>Seed</p>", content_snapshot: "")

    assert_equal "", markdown.current_content
    assert_equal "", html.current_content
  end

  test "database rejects unknown content formats" do
    doc = Document.create!(title: "Constrained")

    assert_raises(ActiveRecord::StatementInvalid) do
      Document.where(id: doc.id).update_all(content_format: "xml")
    end
  end

  include ActionCable::TestHelper
  test "generates a slug on create" do
    doc = Document.create!(title: "Fresh")
    assert doc.slug.present?
    assert_operator doc.slug.length, :>=, 8
  end

  test "slug must be unique" do
    Document.create!(title: "One", slug: "taken-slug")
    dup = Document.new(title: "Two", slug: "taken-slug")
    assert_not dup.valid?
    assert_includes dup.errors[:slug], "has already been taken"
  end

  test "slug is immutable after create" do
    doc = Document.create!(title: "Locked")
    original = doc.slug
    assert_raises(ActiveRecord::ReadonlyAttributeError) { doc.update!(slug: "new-slug") }
    assert_equal original, doc.reload.slug
  end

  test "to_param returns the slug" do
    doc = Document.create!(title: "Param")
    assert_equal doc.slug, doc.to_param
  end

  test "plain_markdown unwraps suggestion ins/del tags keeping content" do
    doc = Document.create!(
      title: "Tracked",
      content_markdown: 'Before <ins data-suggestion-id="a-1" data-author="Kieran">new</ins> ' \
        'and <del data-suggestion-id="a-2" data-author="Kieran">old</del> after'
    )
    assert_equal "Before new and old after", doc.plain_markdown
  end

  test "plain_markdown leaves semantic ins/del without suggestion ids untouched" do
    doc = Document.create!(
      title: "Semantic",
      content_markdown: "Price was <del>$100</del> but <ins>now $80</ins> today"
    )
    assert_equal "Price was <del>$100</del> but <ins>now $80</ins> today", doc.plain_markdown
  end

  test "plain_markdown still strips provenance spans" do
    doc = Document.create!(
      title: "Attributed",
      content_markdown: '<span data-provenance data-kind="ai" data-author="Scout" data-state="pending">robot</span> text'
    )
    assert_equal "robot text", doc.plain_markdown
  end

  test "provenance_summary with no spans is all zeros" do
    doc = Document.create!(title: "Empty")
    assert_equal({ total: 0, human_pct: 0, ai_pct: 0, unreviewed_pct: 0 }, doc.provenance_summary)
  end

  test "provenance_summary cold read reports agent-seeded docs as unreviewed AI" do
    doc = Document.create!(
      title: "AgentSeed", seed_markdown: "# From an agent",
      seed_author_kind: "agent", seed_author_name: "Scout"
    )
    summary = doc.provenance_summary
    assert_equal "From an agent".length, summary[:total]
    assert_equal 0, summary[:human_pct]
    assert_equal 100, summary[:ai_pct]
    assert_equal 100, summary[:unreviewed_pct]
  end

  test "provenance_summary cold read stays zeros for human-seeded docs" do
    doc = Document.create!(
      title: "HumanSeed", seed_markdown: "# Mine",
      seed_author_kind: "human", seed_author_name: "Quiet Falcon"
    )
    assert_equal({ total: 0, human_pct: 0, ai_pct: 0, unreviewed_pct: 0 }, doc.provenance_summary)
  end

  test "provenance_summary cold read stays zeros for legacy docs without authorship" do
    doc = Document.create!(title: "Legacy", seed_markdown: "# Old")
    assert_equal({ total: 0, human_pct: 0, ai_pct: 0, unreviewed_pct: 0 }, doc.provenance_summary)
  end

  test "provenance_summary prefers pushed spans over the seed fallback" do
    doc = Document.create!(
      title: "Snapshotted", seed_markdown: "# From an agent",
      seed_author_kind: "agent", seed_author_name: "Scout",
      provenance_spans: [
        { "kind" => "human", "state" => "verbatim", "chars" => 50 },
        { "kind" => "ai", "state" => "pending", "chars" => 50 }
      ]
    )
    summary = doc.provenance_summary
    assert_equal 100, summary[:total]
    assert_equal 50, summary[:human_pct]
  end

  test "provenance_summary computes percentages from spans" do
    doc = Document.create!(
      title: "Mixed",
      provenance_spans: [
        { "kind" => "human", "state" => "verbatim", "chars" => 62 },
        { "kind" => "ai", "state" => "pending", "chars" => 12 },
        { "kind" => "ai", "state" => "reviewed", "chars" => 26 }
      ]
    )
    summary = doc.provenance_summary
    assert_equal 100, summary[:total]
    assert_equal 62, summary[:human_pct]
    assert_equal 38, summary[:ai_pct]
    assert_equal 12, summary[:unreviewed_pct]
  end

  # --- ownership ---

  test "claim on unclaimed doc sets token, name, and claimed_at" do
    doc = Document.create!(title: "Free")
    doc.claim!(token: "tok-a", name: "Quiet Falcon")

    assert doc.claimed?
    assert_equal "tok-a", doc.owner_token
    assert_equal "Quiet Falcon", doc.owner_name
    assert_not_nil doc.claimed_at
    assert doc.owned_by?("tok-a")
  end

  test "claim on already-claimed doc raises and keeps the first owner" do
    doc = Document.create!(title: "Taken")
    doc.claim!(token: "tok-a", name: "First")

    assert_raises(Document::ClaimRaceError) do
      doc.claim!(token: "tok-b", name: "Second")
    end
    assert_equal "tok-a", doc.reload.owner_token
    assert_equal "First", doc.owner_name
  end

  test "re-claim by the same token no-ops without changing claimed_at, logging, or broadcasting" do
    doc = Document.create!(title: "Mine")
    doc.claim!(token: "tok-a", name: "Owner")
    original_claimed_at = doc.claimed_at
    activity_count = doc.activities.count

    assert_no_broadcasts(DocumentMetaChannel.broadcasting_for(doc)) do
      doc.claim!(token: "tok-a", name: "Owner Again")
    end
    doc.reload
    assert_equal original_claimed_at.to_i, doc.claimed_at.to_i
    assert_equal "Owner", doc.owner_name
    assert_equal activity_count, doc.activities.count
  end

  test "concurrent claims pick exactly one winner" do
    doc = Document.create!(title: "Race")
    # Simulate the other session winning between read and conditional UPDATE.
    Document.where(id: doc.id).update_all(owner_token: "tok-winner", owner_name: "Winner", claimed_at: Time.current)

    assert_raises(Document::ClaimRaceError) do
      doc.claim!(token: "tok-loser", name: "Loser")
    end
    assert_equal "tok-winner", doc.reload.owner_token
  end

  test "same-token requests racing each other resolve as no-op success, not a lost race" do
    doc = Document.create!(title: "Race")
    # The other tab (same browser, same token) commits between this object's
    # load and its conditional UPDATE.
    Document.where(id: doc.id).update_all(owner_token: "tok-a", owner_name: "Owner", claimed_at: Time.current)

    assert_nothing_raised { doc.claim!(token: "tok-a", name: "Owner") }
    assert doc.owned_by?("tok-a")
  end

  test "claim rolls back ownership when the activity insert fails" do
    doc = Document.create!(title: "Free")
    Activity.define_singleton_method(:new) { |*, **| raise "activity insert failed" }
    begin
      assert_raises(RuntimeError) do
        doc.claim!(token: "tok-a", name: "Owner")
      end
    ensure
      Activity.singleton_class.remove_method(:new)
    end
    assert_not doc.reload.claimed?
  end

  test "claim on the demo slug raises UnclaimableError" do
    doc = Document.create!(title: "Demo", slug: "demo")
    assert_raises(Document::UnclaimableError) do
      doc.claim!(token: "tok-a", name: "Grabby")
    end
    assert_not doc.reload.claimed?
    assert_not doc.claimable?
  end

  test "owned_by? is false for nil or blank tokens even on unclaimed docs" do
    doc = Document.create!(title: "Free")
    assert_not doc.owned_by?(nil)
    assert_not doc.owned_by?("")
    doc.claim!(token: "tok-a", name: "Owner")
    assert_not doc.owned_by?(nil)
    assert_not doc.owned_by?("tok-b")
  end

  test "owner_name longer than 255 chars is rejected by validation" do
    doc = Document.new(title: "Long", owner_name: "x" * 256)
    assert_not doc.valid?
    assert_includes doc.errors[:owner_name], "is too long (maximum is 255 characters)"
  end

  test "seed_author_name longer than 255 chars is rejected by validation" do
    doc = Document.new(title: "Long", seed_author_name: "x" * 256)
    assert_not doc.valid?
    assert_includes doc.errors[:seed_author_name], "is too long (maximum is 255 characters)"
  end

  test "seed_author_kind outside human/agent is rejected by validation" do
    doc = Document.new(title: "Odd", seed_author_kind: "bot")
    assert_not doc.valid?
    assert_includes doc.errors[:seed_author_kind], "is not included in the list"

    assert Document.new(title: "OK", seed_author_kind: "agent").valid?
    assert Document.new(title: "OK", seed_author_kind: nil).valid?
  end

  test "claim truncates oversized names instead of failing" do
    doc = Document.create!(title: "Free")
    doc.claim!(token: "tok-a", name: "y" * 400)
    assert_equal 255, doc.reload.owner_name.length
  end

  test "claim logs one activity with the claimer name and broadcasts ownership and activities" do
    doc = Document.create!(title: "Free")

    assert_difference -> { doc.activities.count }, 1 do
      assert_broadcasts(DocumentMetaChannel.broadcasting_for(doc), 2) do
        doc.claim!(token: "tok-a", name: "Quiet Falcon")
      end
    end

    activity = doc.activities.last
    assert_equal "claimed_document", activity.action
    assert_includes activity.detail, "Quiet Falcon"
    assert_equal "human", activity.actor_kind
  end

  test "blank claim name falls back to Anonymous" do
    doc = Document.create!(title: "Free")
    doc.claim!(token: "tok-a", name: "   ")
    assert_equal "Anonymous", doc.reload.owner_name
  end

  test "ownership_props shapes the client payload without leaking the token" do
    doc = Document.create!(title: "Free")
    props = doc.ownership_props(nil)
    assert_equal({ claimed: false, claimable: true, owner_name: nil, yours: false }, props)

    doc.claim!(token: "tok-a", name: "Owner")
    assert_equal({ claimed: true, claimable: false, owner_name: "Owner", yours: true }, doc.ownership_props("tok-a"))
    assert_equal({ claimed: true, claimable: false, owner_name: "Owner", yours: false }, doc.ownership_props("tok-b"))
    assert_not doc.ownership_props("tok-a").value?("tok-a")
  end
end
