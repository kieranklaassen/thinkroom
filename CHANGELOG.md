# Changelog

Notable user-facing changes will be documented here. Thinkroom currently has
no stable release series; changes under development are listed as unreleased.

## Unreleased

- Added: Compound writing for featured accounts. In Comment mode, an account
  holding the `compound_writing` feature gets a Reviewers panel that runs the
  lenses of its installed packs; TypeSafe's Jev answers each lens as yes/no
  questions per phrase, sentence, and paragraph in background jobs, and
  findings stream back as coloured highlights and margin cards (stacked with
  comments) that follow edits. A pack is a Claude Code plugin marketplace
  (`.claude-plugin/marketplace.json`, `skills/*/SKILL.md`) fetched and pinned
  to a commit through `ruby_llm-skills`; each skill becomes a lens through a
  `jev.yml` sidecar, Thinkroom's curated set, or a generated fallback. The
  first pack is `EveryInc/compound-writing` (Hemingway, AI check, Line edit,
  Tracks, Mom, First-time reader, Nemesis, Sorkin, Sedaris, Vonnegut,
  Hitchcock, Developmental edit, BLUF). Lens choices, packs, the pass, and
  dismissals live on the account and survive reload. Grants are operator data
  (`features:grant`, `COMPOUND_WRITING_INITIAL_ACCOUNTS`); requires
  `TYPESAFE_API_KEY` (or `COMPOUND_WRITING_FAKE_JUDGE=1` offline).
- Added: WebMCP browser tools — Thinkroom pages register `thinkroom_*` tools
  (read, create, suggest, comment, resolve, presence, events) for agents
  driving a WebMCP-capable browser; writes are agent-attributed via
  `agent_name` and run at anonymous link-holder privilege. Set
  `WEBMCP_ORIGIN_TRIAL_TOKEN` to join the Chrome origin trial.
- Added: `thinkroom_update_document` WebMCP tool, registered on document
  pages only when the page is writable (opened through an Edit link, claimed
  or not, or owned by the viewer). It is the in-page equivalent of
  `thinkroom update` — it replaces the whole document through the live
  editor, never through the API, with the first heading becoming the title
  and the replaced text landing as pending AI provenance for human review.
- Prepare the repository for public development with community health files,
  automated dependency auditing, write-rate limits, and a portable deployment
  configuration.
