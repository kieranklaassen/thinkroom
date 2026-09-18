module CompoundWriting
  # The reviewers a writer can run, each a lens from EveryInc/compound-writing
  # (main @ 8fd0ec88c00976cf0274cb76552dc7ad9405ca92) reduced to literal yes/no
  # questions Jev can answer about one unit of text. A question's scope says
  # which unit it judges: an n-gram (`phrase`), a `sentence`, a `paragraph`,
  # or the whole `text`. Jev answers the words you write, not the intent
  # behind them, so every question names a concrete, observable property.
  module Reviewers
    SCOPES = %w[phrase sentence paragraph text].freeze
    DEFAULT_THRESHOLD = 0.7

    Question = Data.define(:id, :scope, :question, :note, :threshold) do
      def initialize(id:, scope:, question:, note:, threshold: DEFAULT_THRESHOLD)
        raise ArgumentError, "unknown scope #{scope.inspect}" unless SCOPES.include?(scope)

        super
      end
    end

    Reviewer = Data.define(:key, :name, :blurb, :color, :source, :questions, :lexicon) do
      def question(id) = questions.find { |question| question.id == id }

      def as_props
        {
          key:, name:, blurb:, color:, source:,
          questions: questions.map { |question| { id: question.id, scope: question.scope, note: question.note } }
        }
      end
    end

    ALL = [
      Reviewer.new(
        key: "hemingway", name: "Hemingway", color: 0, source: "skills/cw-hemingway/SKILL.md",
        blurb: "Cuts every word that does not earn its place.",
        lexicon: %w[very really quite somewhat rather basically actually completely absolutely extremely],
        questions: [
          Question.new(id: "cut", scope: "phrase", note: "Cut or shorten: adverb, qualifier, redundancy, or inflated phrase",
                       question: "Is this phrase an adverb, an empty qualifier such as very or quite, a redundancy such as completely finished, or an inflated phrase such as at this point in time that could be cut or shortened without changing the meaning?"),
          Question.new(id: "padding", scope: "sentence", note: "Throat-clearing or passive padding",
                       question: "Does this sentence open with throat-clearing such as it is important to note, or lean on passive voice, so that it could be rewritten shorter with the same meaning?")
        ]
      ),
      Reviewer.new(
        key: "ai_check", name: "AI check", color: 1, source: "skills/cw-ai-check/SKILL.md",
        blurb: "Finds the residue that makes prose sound generated.",
        lexicon: %w[delve leverage utilize tapestry seamless robust pivotal crucial multifaceted moreover furthermore additionally landscape realm],
        questions: [
          Question.new(id: "vocabulary", scope: "phrase", note: "Stock AI vocabulary or template",
                       question: "Is this phrase stock AI vocabulary or a generic template, such as delve, leverage, utilize, tapestry, seamless, robust, pivotal, it is worth noting, in today's fast-paced world, at its core, or a formal transition such as moreover or furthermore?"),
          Question.new(id: "performed", scope: "sentence", note: "Performed symmetry, self-rating, or false enthusiasm",
                       question: "Does this sentence read as machine-generated: a not X but Y contrast, a rule-of-three flourish, commentary that rates its own evidence or signposts its own structure, an empty metaphor, or enthusiasm the material has not earned?"),
          Question.new(id: "overcompletion", scope: "paragraph", note: "Unearned causality, symmetry, or resolution",
                       question: "Does this paragraph supply neat causality, symmetry, or a tidy resolution that reads as generated overcompletion rather than something the material supports?")
        ]
      ),
      Reviewer.new(
        key: "line_edit", name: "Line edit", color: 2, source: "skills/cw-line-edit/SKILL.md",
        blurb: "Sentence-level cuts that keep the voice.",
        lexicon: %w[perhaps maybe might arguably studies\ show some\ say synergy paradigm stakeholders robust],
        questions: [
          Question.new(id: "weak", scope: "phrase", note: "Hedge, weasel word, intensifier, cliché, or jargon",
                       question: "Is this phrase a hedge such as perhaps or somewhat, a weasel attribution such as some people say or studies show, an empty intensifier, a cliché metaphor, or business or academic jargon a line editor would cut or replace?"),
          Question.new(id: "construction", scope: "sentence", note: "Passive, back-loaded, or an echo",
                       question: "Is this sentence in passive voice, does it bury its main point at the end, or does it restate a point the paragraph already made?")
        ]
      ),
      Reviewer.new(
        key: "tracks", name: "Tracks", color: 3, source: "skills/cw-tracks/SKILL.md",
        blurb: "Erases the scaffolding the writer used to get here.",
        lexicon: %w[realized surprisingly I\ think it\ seems this\ raises\ the\ question one\ might\ wonder what\ I\ learned],
        questions: [
          Question.new(id: "narration", scope: "sentence", note: "Process or arrival narration",
                       question: "Does this sentence narrate the writer's process or arrival, such as after much research I realized, this raises the question, one might wonder, surprisingly I found, or what I learned was, instead of stating the thought itself?"),
          Question.new(id: "scaffolding", scope: "paragraph", note: "Scaffolding or warm-up",
                       question: "Is this paragraph warm-up or scaffolding that helped the writer build the argument but that a reader could skip without losing anything the piece needs?")
        ]
      ),
      Reviewer.new(
        key: "mom", name: "Mom", color: 4, source: "skills/cw-mom/SKILL.md",
        blurb: "Where a smart, supportive outsider smiles and nods.",
        lexicon: %w[API CRDT idempotent latency throughput orchestration middleware],
        questions: [
          Question.new(id: "insider", scope: "sentence", note: "Unexplained jargon, name, or insider reference",
                       question: "Would a smart, supportive reader from outside this field smile and nod at this sentence without understanding it, because it uses a technical term, a name, or an insider reference that the text has not explained?"),
          Question.new(id: "stakes", scope: "paragraph", note: "No human stakes, the thread is lost",
                       question: "Would a general reader lose the thread or stop caring in this paragraph because it stays abstract and never connects to a person, a stake, or a consequence they can feel?")
        ]
      ),
      Reviewer.new(
        key: "reader", name: "First-time reader", color: 5, source: "skills/cw-reader/SKILL.md",
        blurb: "A cold read with none of the writer's context.",
        lexicon: %w[as\ mentioned as\ discussed the\ aforementioned obviously clearly of\ course],
        questions: [
          Question.new(id: "reread", scope: "sentence", note: "Needs rereading or missing setup",
                       question: "Would a first-time reader need to read this sentence twice, or does it depend on setup, a term, or a reference that the text has not supplied yet?"),
          Question.new(id: "trust", scope: "paragraph", note: "Unearned trust or attention weakens",
                       question: "Does this paragraph ask the reader for trust, agreement, or patience it has not earned, or is it repetitive or abstract enough that attention would weaken here?")
        ]
      ),
      Reviewer.new(
        key: "nemesis", name: "Nemesis", color: 6, source: "skills/cw-nemesis/SKILL.md",
        blurb: "The least charitable reader attacks every claim.",
        lexicon: %w[everyone knows always never proves obviously undeniably experts\ agree],
        questions: [
          Question.new(id: "claim", scope: "sentence", note: "Unsupported claim, leap, or false dichotomy",
                       question: "Is this sentence an unsupported assertion, an overgeneralization such as everyone or always, a weasel attribution, a leap in reasoning, or a false dichotomy that a hostile reader would attack?"),
          Question.new(id: "evidence", scope: "paragraph", note: "Thin or cherry-picked evidence",
                       question: "Does this paragraph rest its claim on thin evidence, a single cherry-picked example, or an anecdote standing in for data?")
        ]
      ),
      Reviewer.new(
        key: "sorkin", name: "Sorkin", color: 7, source: "skills/cw-sorkin/SKILL.md",
        blurb: "Pacing: walking and talking, not standing still.",
        lexicon: %w[let\ me\ explain in\ this\ section as\ we\ will\ see before\ we\ begin background],
        questions: [
          Question.new(id: "stall", scope: "paragraph", note: "Stall, lecture, meander, or dead end",
                       question: "Does this paragraph stall the piece: explanation with no forward motion, a lecture delivered at the reader, a wander with no visible destination, or an ending that does not push into the next paragraph?")
        ]
      ),
      Reviewer.new(
        key: "sedaris", name: "Sedaris", color: 8, source: "skills/cw-sedaris/SKILL.md",
        blurb: "Finds where specificity or self-implication would land.",
        lexicon: %w[a\ car a\ friend a\ meeting some\ time\ ago a\ while things stuff],
        questions: [
          Question.new(id: "generic", scope: "sentence", note: "Generic where a specific detail would land",
                       question: "Is this sentence generic, such as a car, a friend, or some time ago, where an exact, concrete, or self-implicating detail would make it land or be funny?")
        ]
      ),
      Reviewer.new(
        key: "vonnegut", name: "Vonnegut", color: 9, source: "skills/cw-vonnegut/SKILL.md",
        blurb: "Every sentence reveals character or advances the action.",
        lexicon: %w[in\ this\ post I\ will in\ order\ to\ understand first\ some\ context historically],
        questions: [
          Question.new(id: "wasted", scope: "sentence", note: "Neither reveals character nor advances the action",
                       question: "Does this sentence neither reveal something about a person nor move the piece forward, so a stranger reading it would feel the time was wasted?"),
          Question.new(id: "backstory", scope: "paragraph", note: "Setup the piece could cut to start closer to the end",
                       question: "Is this paragraph backstory or setup the piece could cut so that it starts closer to where things are already happening?")
        ]
      ),
      Reviewer.new(
        key: "hitchcock", name: "Hitchcock", color: 10, source: "skills/cw-hitchcock/SKILL.md",
        blurb: "Where is the bomb under the table?",
        lexicon: %w[in\ the\ end eventually as\ it\ turned\ out fortunately luckily],
        questions: [
          Question.new(id: "tension", scope: "paragraph", note: "Buried stakes or tension released too early",
                       question: "Does this paragraph bury its stakes until the end, or release its tension before the payoff, where showing the risk earlier and holding it would keep the reader leaning forward?")
        ]
      ),
      Reviewer.new(
        key: "dev_edit", name: "Developmental edit", color: 11, source: "skills/cw-dev-edit/SKILL.md",
        blurb: "Argument, structure, stakes, and payoff.",
        lexicon: %w[in\ conclusion to\ summarize in\ summary as\ stated\ above],
        questions: [
          Question.new(id: "place", scope: "paragraph", note: "Does not earn its place in the argument",
                       question: "Does this paragraph fail to earn its place: no clear claim, no support for the claim it makes, or a position out of order with the paragraphs around it?"),
          Question.new(id: "promise", scope: "text", note: "The opening promises a different piece",
                       question: "Does the opening of this text promise a piece different from the one the rest of the text delivers?")
        ]
      ),
      Reviewer.new(
        key: "bluf", name: "BLUF", color: 12, source: "skills/cw-bluf/SKILL.md",
        blurb: "Is the bottom line where the reader first needs it?",
        lexicon: %w[the\ real\ point what\ matters\ most the\ key\ insight ultimately the\ bottom\ line],
        questions: [
          Question.new(id: "buried", scope: "paragraph", note: "Holds the most important idea but arrives late",
                       question: "Does this paragraph hold the most important idea of the text while appearing later than a reader would need it?"),
          Question.new(id: "lede", scope: "text", note: "The bottom line is buried",
                       question: "Is the most important idea of this text buried, so that a reader meets it later than the point where they first need it?")
        ]
      )
    ].freeze

    BY_KEY = ALL.index_by(&:key).freeze
    PROPS = ALL.map(&:as_props).freeze

    module_function

    def all = ALL
    def find(key) = BY_KEY[key.to_s]
    def find!(key) = BY_KEY.fetch(key.to_s) { raise ArgumentError, "unknown reviewer #{key.inspect}" }
    def known?(key) = BY_KEY.key?(key.to_s)
    def as_props = PROPS

    # Keys the client asked for, deduplicated and validated.
    def normalize_keys(keys)
      Array(keys).map(&:to_s).uniq.tap do |list|
        unknown = list.reject { |key| known?(key) }
        raise ArgumentError, "unknown reviewers #{unknown.join(', ')}" if unknown.any?
      end
    end
  end
end
