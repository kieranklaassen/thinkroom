require "test_helper"

class DocumentTest < ActiveSupport::TestCase
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
end
