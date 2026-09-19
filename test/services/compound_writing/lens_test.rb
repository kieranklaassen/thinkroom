require "test_helper"

class CompoundWriting::LensTest < ActiveSupport::TestCase
  def lens_hash(**overrides)
    {
      key: "acme/wander", name: "Wanderer", blurb: "Catches sentences that wander.", color: 0, skill_path: "skills/wander/SKILL.md", origin: "sidecar",
      questions: [ { id: "wander", scope: "sentence", question: "Does this sentence wander without reaching a point?", note: "Wandering", threshold: 0.6 } ],
      lexicon: %w[wander meander]
    }.merge(overrides)
  end

  def refuses(message, **overrides)
    error = assert_raises(ArgumentError) { CompoundWriting::Lens.from_h(lens_hash(**overrides)) }
    assert_match(message, error.message)
  end

  test "a well-formed lens round-trips and trims surrounding whitespace" do
    lens = CompoundWriting::Lens.from_h(lens_hash(name: "  Wanderer ", questions: [ { id: "w", scope: "phrase", question: " Is this phrase padding? " } ]))

    assert_equal "Wanderer", lens.name
    assert_equal "Is this phrase padding?", lens.question("w").question
    assert_equal "Is this phrase padding?", lens.question("w").note, "the note defaults to the question"
    assert_equal 0.7, lens.question("w").threshold
    assert_equal lens.to_h, CompoundWriting::Lens.from_h(lens.to_h).to_h
  end

  test "caps questions per lens and lexicon size" do
    many = (1..9).map { |index| { id: "q#{index}", scope: "sentence", question: "Question #{index}?" } }
    refuses(/9 questions \(maximum 8\)/, questions: many)
    refuses(/lexicon has 41 words \(maximum 40\)/, lexicon: (1..41).map { |index| "w#{index}" })
  end

  test "caps the length of every text field" do
    refuses(/name is longer than 60/, name: "n" * 61)
    refuses(/blurb is longer than 160/, blurb: "b" * 161)
    refuses(/question is longer than 500/, questions: [ { id: "q", scope: "sentence", question: "q" * 501 } ])
    refuses(/note is longer than 80/, questions: [ { id: "q", scope: "sentence", question: "Q?", note: "n" * 81 } ])
    refuses(/question id is longer than 40/, questions: [ { id: "i" * 41, scope: "sentence", question: "Q?" } ])
    refuses(/lexicon word is longer than 40/, lexicon: [ "w" * 41 ])
    refuses(/key acme\/#{'k' * 130} is longer than 120/, key: "acme/#{'k' * 130}")
  end

  test "every field must be one line of printable text" do
    refuses(/question contains a line break/, questions: [ { id: "q", scope: "sentence", question: "Line one\nLine two?" } ])
    refuses(/name contains a line break or non-printable/, name: "Wan\u0007derer")
    refuses(/blurb contains a line break or non-printable/, blurb: "zero\u200Bwidth\u200D")
    refuses(/note contains a line break/, questions: [ { id: "q", scope: "sentence", question: "Q?", note: "a\rb" } ])
    refuses(/lexicon word contains/, lexicon: [ "ok", "bad\tword" ])
    refuses(/question is blank/, questions: [ { id: "q", scope: "sentence", question: "   " } ])
    refuses(/name is blank/, name: "")
  end

  test "structural rules still apply" do
    refuses(/must be <pack>\/<skill>/, key: "Acme/Wander")
    refuses(/unknown origin/, origin: "guessed")
    refuses(/has no questions/, questions: [])
    refuses(/unknown scope "word"/, questions: [ { id: "q", scope: "word", question: "Q?" } ])
    refuses(/threshold must be within/, questions: [ { id: "q", scope: "sentence", question: "Q?", threshold: 0.99 } ])
    refuses(/repeats a question id/, questions: [ { id: "q", scope: "sentence", question: "Q?" }, { id: "q", scope: "phrase", question: "R?" } ])
    refuses(/colour slot/, color: 16)
  end

  test "slug normalises marketplace and skill names" do
    assert_equal "wandering-sentences", CompoundWriting::Lens.slug("Wandering  Sentences")
    assert_equal "beta-lens", CompoundWriting::Lens.slug("_beta lens")
    assert_equal "lens", CompoundWriting::Lens.slug("__")
  end
end
