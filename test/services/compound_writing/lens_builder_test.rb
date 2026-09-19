require "test_helper"

class CompoundWriting::LensBuilderTest < ActiveSupport::TestCase
  SKILL = <<~MD
    ---
    name: %{name}
    description: %{description}
    ---

    # %{name}

    Body.
  MD

  def skill(name, description = "Finds sentences that wander without a point.")
    format(SKILL, name:, description:)
  end

  SIDECAR = <<~YAML
    name: Wanderer
    blurb: Catches sentences that wander.
    lexicon: [wander, meander]
    questions:
      - id: wander
        scope: sentence
        note: Wandering sentence
        question: Does this sentence wander without reaching a point?
        threshold: 0.6
  YAML

  test "a sidecar beside SKILL.md wins and is used verbatim" do
    files = { "skills/wander/SKILL.md" => skill("wander"), "skills/wander/jev.yml" => SIDECAR }

    lenses = CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses")

    assert_equal 1, lenses.size
    lens = lenses.first
    assert_equal "acme/wander", lens.key
    assert_equal "sidecar", lens.origin
    assert_equal "Wanderer", lens.name
    assert_equal %w[wander meander], lens.lexicon
    assert_equal 0.6, lens.question("wander").threshold
    assert_equal "skills/wander/SKILL.md", lens.skill_path
  end

  test "a skill without sidecar or curated set gets a generated lens from its description" do
    files = { "skills/wander/SKILL.md" => skill("wander") }

    lens = CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses").first

    assert_equal "generated", lens.origin
    assert_equal %w[sentence paragraph], lens.questions.map(&:scope)
    assert_match(/Finds sentences that wander without a point/, lens.question("sentence").question)
    assert_empty lens.lexicon
  end

  test "with a curated set, only curated skills become lenses, in curated order" do
    files = {
      "skills/cw-mom/SKILL.md" => skill("cw-mom"), "skills/cw-hemingway/SKILL.md" => skill("cw-hemingway"),
      "skills/cw-draft/SKILL.md" => skill("cw-draft", "Turn notes into a draft.")
    }

    lenses = CompoundWriting::LensBuilder.build(files, pack_name: "compound-writing", marketplace: "EveryInc/compound-writing")

    assert_equal %w[compound-writing/cw-hemingway compound-writing/cw-mom], lenses.map(&:key)
    assert lenses.all? { |lens| lens.origin == "curated" }
    assert_equal "Mom", lenses.last.name
  end

  test "colour slots follow lens order and wrap at sixteen" do
    files = (1..18).to_h { |index| [ "skills/s#{format('%02d', index)}/SKILL.md", skill("s#{index}") ] }

    lenses = CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses")

    assert_equal (0..15).to_a + [ 0, 1 ], lenses.map(&:color)
  end

  test "a malformed sidecar is a readable error" do
    files = { "skills/wander/SKILL.md" => skill("wander"), "skills/wander/jev.yml" => "questions:\n  - id: x\n    scope: word\n    question: Q?\n" }

    error = assert_raises(CompoundWriting::LensBuilder::Invalid) { CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses") }
    assert_match(%r{skills/wander/SKILL.md: .*unknown scope "word"}, error.message)
  end

  test "a plugin with no lens-yielding skill is an error" do
    assert_raises(CompoundWriting::LensBuilder::Invalid) { CompoundWriting::LensBuilder.build({ "README.md" => "x" }, pack_name: "acme", marketplace: "acme/lenses") }
  end
end
