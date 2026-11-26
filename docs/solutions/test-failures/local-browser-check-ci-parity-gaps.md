---
title: "Browser checks fail locally but pass in CI"
date: 2026-09-22
category: test-failures
module: "script/browser_check.mjs and the other Playwright checks / local dev server"
problem_type: test_failure
component: testing_framework
symptoms:
  - 'script/browser_check.mjs crashes with "comment fixture API failed: 429" after creating documents from one IP'
  - "the editor step times out double-clicking the human-<ts> sentinel after many earlier local runs"
  - "the seeded demo document (/d/demo) has a truncated title and dozens of stray comments and suggestions"
  - "bin/vite dev cannot bind its configured port because another project holds :3036"
  - "a phone-width swipe check on a row below the fold does nothing"
root_cause: incomplete_setup
resolution_type: environment_setup
severity: medium
tags: [browser-check, playwright, ci-parity, rate-limit, seed-data, vite-port, local-dev]
---

# Browser checks fail locally but pass in CI

## Problem

The Playwright browser checks (`script/browser_check.mjs`, `script/native_shell_check.mjs`, `script/webmcp_check.mjs`, `script/mobile_zoom_check.mjs`, and the rest of the CI loop) pass in CI but fail when run locally against a long-lived dev server. The failures come from local environment state that CI never has: per-IP rate-limit counters, a demo document mutated by earlier runs, and a Vite port already taken by another project. None of them is a regression in the code under test.

## Symptoms

- The comment-card slice of the browser check aborts with a 429 from the document creation API:
  ```
  browser check crashed: comment fixture API failed: 429 http://localhost:3005/api/docs
  ```
  The message comes from the `cardFetch` helper in `script/browser_check.mjs`, and the crash line from its top-level catch.
- After the rate limit is out of the way, the editor step times out:
  ```
  locator.dblclick: Timeout 30000ms exceeded ... waiting for locator('.milkdown .ProseMirror p').filter({ hasText: 'human-<ts>' })
  ```
  The sentinel is typed after the first top-level paragraph and then double-clicked (`humanSentinel` in `script/browser_check.mjs`). At the time `/d/demo` had the title "The P", 30 comments and 13 suggestions left over from earlier runs, so the paragraph the check targets no longer had the shape it expects.
- `bin/vite dev` cannot bind its configured port because another project's Vite server already holds `:3036` (`development.port` in `config/vite.json`).
- On a phone-width layout, a swipe gesture on a list row that sits below the fold does nothing, and the check reports that the row never opened.

## What Didn't Work

- **Treating the first crash as a regression.** The first failure landed right after the notebook index redesign, so it looked like that change had broken the editor or comment flow. It had not. The same checks passed in CI, which starts from a fresh database and a fresh server process. Comparing the local run to the `browser_checks` job in `.github/workflows/ci.yml` rather than bisecting the feature diff is what found the cause.
- **Re-running `bin/rails db:seed` to reset the demo doc.** The seed uses `Document.find_or_create_by!(slug: "demo")` (`db/seeds.rb`). The block only runs when the record is missing, so re-seeding leaves a polluted demo document exactly as it was: title, comments, suggestions and Yjs state all survive.
- **Clearing the cache from a separate process.** This session ran `bin/rails runner 'Rails.cache.clear'` after tripping the limit. The current tree says this cannot reach a running server: development uses `config.cache_store = :memory_store` (`config/environments/development.rb`), and the rate limiter stores its counters in `Rails.cache` outside the test env (`WriteRateLimited::STORE`). A `rails runner` process gets its own empty memory store. What actually reset the counters was restarting Rails, which the fix does anyway to pick up the env overrides below.

## Solution

Reproduce the three pieces of CI setup that a local dev server lacks.

**1. Raise the per-IP document creation limits at server boot.** CI sets them on its "Start Rails and Vite" step:

```yaml
env:
  THINKROOM_DOC_CREATION_BURST: "500"
  THINKROOM_DOC_CREATION_DAILY: "500"
```

The defaults are 20 creations per 10 minutes and 100 per day per IP (`rate_limit_document_creation` in `app/controllers/concerns/write_rate_limited.rb`), applied to both `DocumentsController` and `Api::DocsController`. One CI check loop creates more than 15 documents from one IP, so a second local run inside ten minutes, or a day of runs against the same server, trips the defaults. The limits are constants read when the class loads, so the env vars must be present when the server starts; setting them in the shell that runs `node script/...` does nothing.

**2. Rebuild the demo document instead of re-seeding over it.** CI runs `bin/rails db:prepare db:seed` on an empty database. Locally, destroy the record first so the seed's create block runs again:

```bash
bin/rails runner 'Document.find_by(slug: "demo")&.destroy!' && bin/rails db:seed
```

`Document` destroys its comments, suggestions, Yjs updates, archives and pins with it (the dependent associations in `app/models/document.rb`), so the re-seeded `/d/demo` starts from the canonical "The Proof Demo Document" source in `db/seeds.rb`.

**3. Move Vite off a taken port.** Pass the same override to both processes so Rails proxies `/vite-dev` to the right place:

```bash
VITE_RUBY_PORT=3046 bin/vite dev
VITE_RUBY_PORT=3046 THINKROOM_DOC_CREATION_BURST=500 THINKROOM_DOC_CREATION_DAILY=500 bin/rails s -p 3005
```

Keep `skipProxy: false` (`config/vite.json`) so assets are still served through the Rails origin.

`script/compound_writing_check.mjs` needs two more pieces of the CI job: the account from its "Prepare the compound writing check account" step, and `COMPOUND_WRITING_FAKE_JUDGE=1` in the server's environment.

With the first three in place, `BASE_URL=http://localhost:3005 node script/browser_check.mjs` passed with 218 passing assertions and 0 failures in this session's run, and the other checks passed the same way.

**Related gesture fix.** In this session, Playwright's `page.mouse` actions at coordinates outside the viewport were dropped without an error. On a phone layout the notebook's Contents list sits below the left page, so `swipeOpen` in `script/native_shell_check.mjs` now calls `target.scrollIntoViewIfNeeded()` before reading the bounding box and dragging:

```js
const swipeOpen = async (target) => {
  // On a phone Contents sits below the left page; mouse events outside the
  // viewport are dropped, so bring the row on screen first.
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  ...
}
```

## Why This Works

CI's browser job always starts from three clean conditions: a freshly seeded database, a new server process whose rate-limit counters are empty and whose limits are raised to 500, and free ports on the runner. A local dev server that has been running checks all day breaks each of these.

- The rate limiter keys on `request.remote_ip` and keeps counts in process memory for 10 minutes and 1 day. Repeated local runs add up past the defaults of 20 and 100. Raising the limits at boot matches CI, and restarting the process empties the in-memory counters.
- The browser check edits the demo document itself (title, typed sentinels, comments, suggestions), and nothing resets it between runs. `find_or_create_by!` only guards against a missing record; it is not a reset. Destroying the record and seeding again returns the document to the state the check's selectors were written against.
- Vite Ruby reads `VITE_RUBY_PORT` in both the Vite process and the Rails proxy, so overriding it in both keeps them in agreement while avoiding the collision on `config/vite.json`'s port.
- Playwright sends mouse events to the page at viewport coordinates. A bounding box below the fold yields coordinates the page never receives, so the swipe silently does nothing. Scrolling the row into view first puts the coordinates back inside the viewport.

## Prevention

- **Before debugging a local browser-check failure as a regression, rule out environment state.** Ask: does this pass in CI, which starts clean? If so, reset the local environment first (restart Rails with the CI env, rebuild `/d/demo`) and re-run before reading the feature diff.
- **Start the local check server the way CI does.** A single command that mirrors the limits CI sets:
  ```bash
  THINKROOM_DOC_CREATION_BURST=500 THINKROOM_DOC_CREATION_DAILY=500 PORT=3005 bin/dev
  ```
  Add `VITE_RUBY_PORT=<free port>` if another project already holds `:3036`.
- **Reset the demo document between batches of runs**, not just when something breaks:
  ```bash
  bin/rails runner 'Document.find_by(slug: "demo")&.destroy!' && bin/rails db:seed
  ```
- **Clear rate limits by restarting the server, not with `rails runner`.** In development the counters live in the server's memory store; a separate process cannot see them.
- **Write checks that tolerate a used demo doc where possible.** The browser check already moved from keyboard line selection to double-clicking its own typed sentinel because prior runs left images and empty lines at the document edges. Anchor selections to text the check itself wrote, not to the demo document's original content.
- **Scroll before any coordinate-based gesture.** Any helper that uses `page.mouse.move/down/up` on a locator's bounding box should call `locator.scrollIntoViewIfNeeded()` first, especially under phone viewports where layout pushes content below the fold. Prefer locator actions (`locator.click()`, `locator.dragTo()`), which scroll automatically, when the gesture allows it.

## Related Issues

- Issue #205 (flaky browser checks) is a different failure class: checks that acted before the condition they assert. Load only widened the windows. Its causes, for the next one that looks like a timeout:
  - `load` is not hydration. Server-rendered controls are visible and clickable before they have handlers (`waitForHome`).
  - A document editor goes live from the last compacted state; newer edits arrive with the sync after it (`reloadSynced`).
  - A cold Vite cache reloads the page that warms it, so a first run can open the demo before its content is stored. A page that waits for its first content keeps the server-painted body and its editor is not live, so wait for the content itself (`openSeeded`). A missing editor looks like a layout or selection failure.
  - `page.waitForFunction` does not poll an async predicate: it calls it once and settles for its `false`. Poll from the script instead (`ownershipBecomes` in `script/webmcp_check.mjs`).
  - Finding cards stream in, and a finished card folds past three rows in timing order.
  - A wheel gesture larger than the page keeps animating at the edge and overrides a later programmatic scroll. The step can still pass while acting on the wrong text, so assert what a drag selected.
