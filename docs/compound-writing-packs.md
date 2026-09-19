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

A row is one immutable version, keyed by (locator, plugin, SHA). Installing a
locator again resolves the ref: the same commit returns the existing row
untouched; a new commit is a new row. `UserWritingPack.subscribe!` then moves
only the requester's subscription to that version (keeping its choices for
lenses that still exist), so no install can change what another account has
already installed. A malicious or broken pack version therefore reaches only
the accounts that chose to install that exact version. Old versions nobody
subscribes to can be pruned later.

A plugin must live in the marketplace repository itself: a relative source, or
a `github` source naming the same owner/repo as the locator. Other
repositories, archives, and hosted URLs are refused with an install error, so
the server (and its optional `MARKETPLACE_GITHUB_TOKEN`) only ever fetches the
repository the user typed.

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

Pack-authored text becomes Jev instructions, so `CompoundWriting::Lens`
bounds it and a pack that breaks a bound fails to install: at most 40 lenses
per pack and 8 questions per lens; names up to 60 characters, blurbs 160,
notes 80, questions 500, question ids 40, lexicon up to 40 words of 40
characters; every field one line of printable text (control and format
characters, line and paragraph separators are rejected; surrounding
whitespace is trimmed and nothing else is rewritten). The generated path
first reduces the SKILL.md description to one printable line and caps it at
240 characters.

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

Compound writing is gated by the `compound_writing` Flipper flag, checked
through `CompoundWriting.available_to?(user)` (`Flipper.enabled?(:compound_writing,
user)` for a signed-in account). Enable it per account in Flipper UI at
`/admin/flipper` (admin accounts) or from a shell:

```bash
bin/rails "flags:enable[compound_writing,someone@example.com]"
bin/rails "compound_writing:install[EveryInc/compound-writing,someone@example.com]"
bin/rails "compound_writing:install[acme/lenses@main,someone@example.com,acme-lenses]"   # named plugin
bin/rails "flags:list[compound_writing]"
bin/rails compound_writing:list
```

An enabled account is subscribed to the first pack lazily, on its first
Comment-mode visit (`CompoundWriting::FirstPack.seed!`), once:
`users.compound_writing_seeded_at` records it so a later removal is respected.
`db:seed` builds the pack version offline from the curated set at the SHA it
was written against.

In the app, an enabled account opens a document in Comment mode: the Reviewers
panel lists each subscribed pack (marketplace, version, and short commit SHA,
with the full SHA on hover) with its lenses and a switch per lens, "Add pack"
installs a marketplace by locator, and "Remove" drops the subscription (the
version row stays for other subscribers). A run posts the lenses that are on;
the pass snapshots their definitions, so its findings keep their names and
colours even after the pack changes.

## Adding a lens to the curated set

Edit `config/compound_writing/lenses/<owner>--<repo>.yml`, add a skill entry,
and reinstall the pack (`compound_writing:install`) or let the next refresh
pick it up. Give every lens a `lexicon` so the FakeJudge (development, CI) can
flag something for it.
