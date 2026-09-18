# Changelog

Notable user-facing changes will be documented here. Thinkroom currently has
no stable release series; changes under development are listed as unreleased.

## Unreleased

- Added: Compound writing mode (`/d/:slug/compound`, Cmd+5). Writers run the
  Compound Writing reviewers (Hemingway, AI check, Line edit, Tracks, Mom,
  First-time reader, Nemesis, Sorkin, Sedaris, Vonnegut, Hitchcock,
  Developmental edit, BLUF) over the document; TypeSafe's Jev answers each
  lens as yes/no questions per phrase, sentence, and paragraph in background
  jobs, and findings stream back as per-reviewer highlights and margin cards
  that follow edits. Reviewer toggles, the pass, and dismissals survive
  reload. Requires `TYPESAFE_API_KEY` (or `COMPOUND_WRITING_FAKE_JUDGE=1`
  offline).
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
