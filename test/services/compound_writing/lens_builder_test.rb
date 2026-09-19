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

  test "title-case or spaced marketplace and skill names become stable slugs in the key, unique within the pack" do
    files = {
      "skills/Wandering Sentences/SKILL.md" => skill("Wandering Sentences"),
      "skills/wandering-sentences/SKILL.md" => skill("wandering-sentences", "A second skill whose folder slugs the same."),
      "skills/BLUF  Check/SKILL.md" => skill("BLUF Check", "Leads with the point."),
      "skills/BLUF  Check/jev.yml" => SIDECAR
    }

    lenses = CompoundWriting::LensBuilder.build(files, pack_name: "Acme Lenses", marketplace: "acme/lenses")

    assert_equal %w[acme-lenses/bluf-check acme-lenses/wandering-sentences acme-lenses/wandering-sentences-2], lenses.map(&:key)
    assert_equal "skills/BLUF  Check/SKILL.md", lenses.first.skill_path, "the path keeps the directory as written"
    assert_equal "Wanderer", lenses.first.name, "the sidecar's display name is untouched"
    assert_equal "Wandering Sentences", lenses[1].name, "the frontmatter name is untouched"
  end

  test "a generated suffix never collides with a folder whose natural slug is that string" do
    files = {
      "skills/lens/SKILL.md" => skill("lens"),
      "skills/Lens/SKILL.md" => skill("Lens", "Same slug, different case."),
      "skills/lens-2/SKILL.md" => skill("lens-2", "Naturally named lens-2.")
    }

    lenses = CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses")

    keys = lenses.map(&:key)
    assert_equal keys.uniq, keys
    assert_equal "acme/lens-2", lenses.find { |lens| lens.skill_path == "skills/lens-2/SKILL.md" }.key, "the natural slug keeps its key"
    assert_equal %w[acme/lens acme/lens-3], lenses.reject { |lens| lens.skill_path == "skills/lens-2/SKILL.md" }.map(&:key).sort
    assert_equal keys, CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses").map(&:key), "deterministic"
  end

  test "a skill folder that opens with a separator still yields a parsable key" do
    files = { "skills/_beta lens/SKILL.md" => skill("_beta lens") }

    lens = CompoundWriting::LensBuilder.build(files, pack_name: "Acme Lenses", marketplace: "acme/lenses").first

    assert_equal "acme-lenses/beta-lens", lens.key
  end

  test "colour slots follow lens order and wrap at sixteen" do
    files = (1..18).to_h { |index| [ "skills/s#{format('%02d', index)}/SKILL.md", skill("s#{index}") ] }

    lenses = CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses")

    assert_equal (0..15).to_a + [ 0, 1 ], lenses.map(&:color)
  end

  test "a plugin with more than forty lens-yielding skills is refused" do
    files = (1..41).to_h { |index| [ "skills/s#{format('%02d', index)}/SKILL.md", skill("s#{index}") ] }

    error = assert_raises(CompoundWriting::LensBuilder::Invalid) { CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses") }
    assert_match(/41 lenses \(maximum 40\)/, error.message)
  end

  test "a generated lens reduces a multi-line description with format characters to one bounded line" do
    # A literal block scalar keeps its line breaks; the zero-width space is a
    # format character YAML accepts but a lens field must not carry.
    description = "Finds\u200B sentences that\n  wander " + ("far " * 120)
    files = { "skills/wander/SKILL.md" => "---\nname: wander\ndescription: |\n  #{description.gsub("\n", "\n  ")}\n---\n# wander\n" }

    lens = CompoundWriting::LensBuilder.build(files, pack_name: "acme", marketplace: "acme/lenses").first

    question = lens.question("sentence").question
    assert_match(/\AIs|\ADoes/, question)
    assert_no_match(/[\u200B\n]/, question)
    assert_operator question.length, :<=, CompoundWriting::Lens::MAX_QUESTION_LENGTH
    assert_match(/Finds sentences that wander/, question)
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
