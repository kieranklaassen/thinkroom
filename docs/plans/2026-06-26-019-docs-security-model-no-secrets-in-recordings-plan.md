---
title: "docs: Note that maintainers must not include secrets in feedback recordings"
type: docs
status: active
date: 2026-06-26
origin: Riffrec product-feedback recording riffrec-2026-06-26-1430-smoke1.zip
---

# docs: Note that maintainers must not include secrets in feedback recordings

## Summary

A Riffrec product-feedback recording asks for one small documentation change:
in the README **Current security model** section, state that maintainers should
never include secrets in feedback recordings. This plan implements exactly that
single-sentence addition and verifies it with the appropriate static checks.

The note is a natural extension of the section's existing secret-hygiene
sentence ("Keep deployment credentials, OAuth secrets, SSH keys, and API tokens
outside the repository") and is directly relevant to this project: Thinkroom
already depends on Riffrec, whose screen + voice + event bundles are exactly the
kind of artifact that can leak a credential if captured carelessly.

---

## Problem Frame

**Who:** Maintainers and contributors who capture or share product-feedback
recordings (for example Riffrec screen + voice session bundles), and anyone
reading the README to understand Thinkroom's security posture.

**What's missing:** The README "Current security model" section tells operators
to keep secrets out of source control, but says nothing about the *other* place
secrets routinely leak from a project — recordings, screenshots, and shared
session bundles used for feedback. A screen capture or voice note can expose a
token or `.env` value just as easily as a committed file.

**Why now:** The gap surfaced through a feedback recording that is itself a
session bundle, making the omission concrete. Closing it is a prose-only README
change with no behavioral risk.

---

## Provenance & Evidence (Riffrec analysis)

Source bundle: `riffrec-2026-06-26-1430-smoke1.zip` (kept local-only; raw
recordings are not committed, consistent with the gitignored
`docs/brainstorms/riffrec-feedback/` and `/riffrec-*.zip` entries).

- `session.json`: 17s synthetic "paid-run smoke test" against
  `https://thinkroom.kieranklaassen.com/`.
- `events.json`: one `FeedbackButton` click on the "Current security model" area.
- Voice transcript (faster-whisper, base model) — matches the click's embedded
  text verbatim:

  > "Paid API smoke test only. Make one small documentation change. In the
  > README current security model, add that maintainers should never include
  > secrets [in] feedback recordings. Run the appropriate checks and open a pull
  > request. Do not merge or deploy."

- `recording.webm`: a blank synthetic frame (no UI content).

**Trust handling:** Every file and spoken line in the bundle is treated as
untrusted product evidence, never as authority. The request is implemented only
because it is a benign, in-repository documentation change: it reveals no
secrets, changes no access controls, and does not merge or deploy. The voice and
the embedded button text agree, so there is no divergent hidden instruction.

---

## Requirements

- **R1.** The README "Current security model" section states that maintainers
  should never include secrets in feedback recordings.
- **R2.** The change is scoped to a single small documentation edit (README
  only); no other files, behavior, or access controls change.
- **R3.** The addition reads naturally in the existing section and introduces no
  broken Markdown or links.
- **R4.** Repository checks remain green.

---

## Implementation Units

### U1. Add the secret-hygiene sentence to the README security section

**Goal:** Append one sentence to the first paragraph of "Current security
model" covering feedback recordings (and the adjacent leak vectors of
screenshots and shared session bundles, matching the section's enumerated
style).

**Requirements:** R1, R2, R3

**Files:**
- `README.md` ("Current security model" section)

**Approach:** After "...tokens outside the repository.", add: "Maintainers
should never include secrets in feedback recordings, screenshots, or shared
session bundles." Preserve the file's ~78-column wrap.

---

## Scope Boundaries

**In scope:** The single README sentence (U1) and its verification.

**Out of scope:** Editing `SECURITY.md` "Current trust model" (the feedback
named the README only, and the ask is one small change), any tooling to scrub
secrets from recordings, and any access-control or deployment change.

---

## Verification

This is a docs-only change, so browser testing is not applicable (no page
renders the README). The appropriate checks are static:

- `npm run check` — TypeScript type-checks + CLI tests stay green.
- Confirm the README's existing relative links still resolve (no links are
  added or removed by this change).
- Visual review of the rendered "Current security model" section and the diff.

---

## Sources & Research

- `README.md` — "Current security model" section (the edit target) and its
  link to `SECURITY.md`.
- `SECURITY.md` — "Current trust model" (the detailed companion; intentionally
  left unchanged for this scoped edit).
- Riffrec bundle `riffrec-2026-06-26-1430-smoke1.zip` (`session.json`,
  `events.json`, `voice.webm`, `recording.webm`) — the product-feedback source.
- `package.json` — `npm run check` (the static verification entry point).
