# Compound writing packs

A pack is one plugin from a Claude Code plugin marketplace: a repository with
`.claude-plugin/marketplace.json` naming plugins, each plugin a folder of
`skills/<name>/SKILL.md`. Thinkroom turns every skill in a pack into a
reviewer lens and asks TypeSafe's Jev the lens's yes/no questions over a
document. `EveryInc/compound-writing` is the first pack; any repository with
the same shape works.

## How a pack is fetched and pinned

`CompoundWriting::PackInstaller` takes a locator (`owner/repo`,
`owner/repo@branch`, or `owner/repo@<commit>`), resolves the ref to a commit
through `ruby_llm-skills`' marketplace layer (`RubyLLM::Skills::Marketplace::
Fetcher`: api.github.com for the ref, raw.githubusercontent.com for the
marketplace file, codeload.github.com for the plugin tarball; HTTPS only, no
`git`), reads the marketplace file with `Manifest.discover`, picks the plugin
(the only one, or the one named), and hands the plugin's files to
`CompoundWriting::LensBuilder`. The result is a `WritingPack` row: marketplace
name, plugin name, version, the commit SHA it was fetched at, and the lenses.
The row is the lock: installing the same locator again refreshes it to the
requested ref, and subscribers keep their choices for lenses that still exist.

Thinkroom does not use the gem's filesystem `Registry` or `skills-lock.json`
because a pack belongs to accounts in the database and the container's
filesystem is ephemeral.

## How a SKILL.md becomes a lens

For each `skills/<name>/SKILL.md`, in this order:

1. **Sidecar.** A `skills/<name>/jev.yml` beside the SKILL.md defines the lens
   verbatim (origin `sidecar`). This is the convention for pack authors.
2. **Curated set.** Thinkroom keeps question sets for marketplaces whose skills
   carry no sidecar, one YAML per marketplace at
   `config/compound_writing/lenses/<owner>--<repo>.yml`, keyed by skill name
   (origin `curated`). When a curated set exists for a marketplace, only its
   skills become lenses; the other skills are writing tools (draft, outline),
   not reviewers.
3. **Generated.** Otherwise the skill's frontmatter `description` becomes two
   literal questions, one per sentence and one per paragraph: "Does this
   sentence show the problem this reviewer looks for: <description>?" (origin
   `generated`). Weak by design and labelled so in the panel; a sidecar gives
   a sharper lens.

Lens keys are `<marketplace name>/<skill name>`, for example
`compound-writing/cw-hemingway`. Colour slots (0-15) are assigned in lens
order and wrap.

## The sidecar schema (`skills/<name>/jev.yml`)

```yaml
name: Hemingway              # optional; defaults to the SKILL.md name
blurb: Cuts every word that does not earn its place.
lexicon: [very, really, quite]   # optional; words the offline FakeJudge flags
questions:
  - id: cut                  # unique within the lens
    scope: phrase            # phrase | sentence | paragraph | text
    note: Cut or shorten     # short label shown on findings; defaults to the question
    threshold: 0.7           # optional; 0.05-0.95, default 0.7
    question: Is this phrase an adverb, an empty qualifier such as very or quite, or an inflated phrase that could be cut without changing the meaning?
```

Scopes decide what Jev is asked about: `phrase` runs over 1-3 word n-grams
inside a sentence (findings fill the text), `sentence` over each sentence
(findings underline), `paragraph` over each paragraph of at least 15 words, and
`text` once over the whole document. Questions are literal yes/no questions
about one unit of text, phrased the way Jevgram does: name the unit ("this
phrase", "this sentence"), describe the problem concretely with examples, and
avoid asking for judgement Jev cannot make from the unit alone. A finding is
kept when Jev's probability of "yes" reaches the threshold.

The curated YAML uses the same fields per skill under a `skills:` map, plus
`marketplace`, `pinned_sha`, `version`, `display_name`, and `description` for
the offline bootstrap.

## Accounts, packs, and lenses

Compound writing is gated by the `compound_writing` account feature
(`Features`, stored in `users.features`). Operators grant it without a deploy:

```bash
bin/rails "features:grant[someone@example.com,compound_writing]"
bin/rails "compound_writing:install[EveryInc/compound-writing,someone@example.com]"
bin/rails "compound_writing:install[acme/lenses@main,someone@example.com,acme-lenses]"   # named plugin
bin/rails "features:list[compound_writing]"
bin/rails compound_writing:list
```

The boot migration and `db:seed` grant the feature and subscribe the first pack
for the accounts in `COMPOUND_WRITING_INITIAL_ACCOUNTS`, building the pack
offline from the curated set at the SHA it was written against.

In the app, a featured account opens a document in Comment mode: the Reviewers
panel lists each subscribed pack with its lenses and a switch per lens, "Add
pack" installs a marketplace by locator, and "Remove" drops the subscription
(the pack row stays for other subscribers). A run posts the lenses that are on;
the pass snapshots their definitions, so its findings keep their names and
colours even after the pack changes.

## Adding a lens to the curated set

Edit `config/compound_writing/lenses/<owner>--<repo>.yml`, add a skill entry,
and reinstall the pack (`compound_writing:install`) or let the next refresh
pick it up. Give every lens a `lexicon` so the FakeJudge (development, CI) can
flag something for it.
