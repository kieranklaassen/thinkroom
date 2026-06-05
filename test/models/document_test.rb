require "test_helper"

class DocumentTest < ActiveSupport::TestCase
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

  test "provenance_summary with no spans is all zeros" do
    doc = Document.create!(title: "Empty")
    assert_equal({ total: 0, human_pct: 0, ai_pct: 0, unreviewed_pct: 0 }, doc.provenance_summary)
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

    assert_raises(ActiveRecord::RecordInvalid) do
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

    assert_nothing_raised { doc.claim!(token: "tok-a", name: "Owner Again") }
    doc.reload
    assert_equal original_claimed_at.to_i, doc.claimed_at.to_i
    assert_equal "Owner", doc.owner_name
    assert_equal activity_count, doc.activities.count
  end

  test "concurrent claims pick exactly one winner" do
    doc = Document.create!(title: "Race")
    # Simulate the other session winning between read and conditional UPDATE.
    Document.where(id: doc.id).update_all(owner_token: "tok-winner", owner_name: "Winner", claimed_at: Time.current)

    assert_raises(ActiveRecord::RecordInvalid) do
      doc.claim!(token: "tok-loser", name: "Loser")
    end
    assert_equal "tok-winner", doc.reload.owner_token
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
