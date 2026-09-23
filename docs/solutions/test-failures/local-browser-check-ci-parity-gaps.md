---
title: "Browser checks fail locally but pass in CI"
date: 2026-09-22
category: test-failures
module: "script/browser_check.mjs and the other Playwright checks / local dev server"
problem_type: test_failure
component: testing_framework
symptoms:
  - "script/browser_check.mjs crashes with "comment fixture API failed: 429" after creating documents from one IP"
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
  The message comes from the `cardFetch` helper (`script/browser_check.mjs:260-264`), and the crash line from the top-level catch (`script/browser_check.mjs:3445`).
- After the rate limit is out of the way, the editor step times out:
  ```
  locator.dblclick: Timeout 30000ms exceeded ... waiting for locator('.milkdown .ProseMirror p').filter({ hasText: 'human-<ts>' })
  ```
  The sentinel is typed after the first top-level paragraph and then double-clicked (`script/browser_check.mjs:2090-2094`, `script/browser_check.mjs:2122`). At the time `/d/demo` had the title "The P", 30 comments and 13 suggestions left over from earlier runs, so the paragraph the check targets no longer had the shape it expects.
- `bin/vite dev` cannot bind its configured port because another project's Vite server already holds `:3036` (`config/vite.json:11`).
- On a phone-width layout, a swipe gesture on a list row that sits below the fold does nothing, and the check reports that the row never opened.

## What Didn't Work

- **Treating the first crash as a regression.** The first failure landed right after the notebook index redesign, so it looked like that change had broken the editor or comment flow. It had not. The same checks passed in CI, which starts from a fresh database and a fresh server process. Comparing the local run to the CI job setup (`.github/workflows/ci.yml:145-162`) rather than bisecting the feature diff is what found the cause.
- **Re-running `bin/rails db:seed` to reset the demo doc.** The seed uses `Document.find_or_create_by!(slug: "demo")` (`db/seeds.rb:55-58`). The block only runs when the record is missing, so re-seeding leaves a polluted demo document exactly as it was: title, comments, suggestions and Yjs state all survive.
- **Clearing the cache from a separate process.** This session ran `bin/rails runner 'Rails.cache.clear'` after tripping the limit. The current tree says this cannot reach a running server: development uses `config.cache_store = :memory_store` (`config/environments/development.rb:29`), and the rate limiter stores its counters in `Rails.cache` outside the test env (`app/controllers/concerns/write_rate_limited.rb:4`). A `rails runner` process gets its own empty memory store. What actually reset the counters was restarting Rails, which the fix does anyway to pick up the env overrides below.

## Solution

Reproduce the three pieces of CI setup that a local dev server lacks.

**1. Raise the per-IP document creation limits at server boot.** CI sets them on the step that starts Rails and Vite (`.github/workflows/ci.yml:151-162`):

```yaml
env:
  THINKROOM_DOC_CREATION_BURST: "500"
  THINKROOM_DOC_CREATION_DAILY: "500"
```

The defaults are 20 creations per 10 minutes and 100 per day per IP (`app/controllers/concerns/write_rate_limited.rb:9-10, 18-24`), applied to both `DocumentsController` and `Api::DocsController` (`app/controllers/documents_controller.rb:3`, `app/controllers/api/docs_controller.rb:3`). The code's own estimate is that one CI check loop creates ~15+ documents from one IP (`app/controllers/concerns/write_rate_limited.rb:6`), so a second local run inside ten minutes, or a day of runs against the same server, trips the defaults. The limits are constants read when the class loads, so the env vars must be present when the server starts; setting them in the shell that runs `node script/...` does nothing.

**2. Rebuild the demo document instead of re-seeding over it.** CI runs `bin/rails db:prepare db:seed` on an empty database (`.github/workflows/ci.yml:145-146`). Locally, destroy the record first so the seed's create block runs again:

```bash
bin/rails runner 'Document.find_by(slug: "demo")&.destroy!' && bin/rails db:seed
```

`Document` destroys its comments, suggestions, Yjs updates, archives and pins with it (`app/models/document.rb:40-49`), so the re-seeded `/d/demo` starts from the canonical "The Proof Demo Document" markdown (`db/seeds.rb:55-58`).

**3. Move Vite off a taken port.** Pass the same override to both processes so Rails proxies `/vite-dev` to the right place:

```bash
VITE_RUBY_PORT=3046 bin/vite dev
VITE_RUBY_PORT=3046 THINKROOM_DOC_CREATION_BURST=500 THINKROOM_DOC_CREATION_DAILY=500 bin/rails s -p 3005
```

Keep `skipProxy: false` (`config/vite.json:9`) so assets are still served through the Rails origin.

With all three in place, `BASE_URL=http://localhost:3005 node script/browser_check.mjs` passed with 218 passing assertions and 0 failures in this session's run, and the other checks passed the same way.

**Related gesture fix.** In this session, Playwright's `page.mouse` actions at coordinates outside the viewport were dropped without an error. On a phone layout the notebook's Contents list sits below the left page, so `swipeOpen` in `script/native_shell_check.mjs:267-279` now calls `target.scrollIntoViewIfNeeded()` before reading the bounding box and dragging:

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

- The rate limiter keys on `request.remote_ip` and keeps counts in process memory for 10 minutes and 1 day (`app/controllers/concerns/write_rate_limited.rb:19-24`). Repeated local runs add up past the defaults of 20 and 100. Raising the limits at boot matches CI, and restarting the process empties the in-memory counters.
- The browser check edits the demo document itself (title, typed sentinels, comments, suggestions), and nothing resets it between runs. `find_or_create_by!` only guards against a missing record; it is not a reset. Destroying the record and seeding again returns the document to the state the check's selectors were written against.
- Vite Ruby reads `VITE_RUBY_PORT` in both the Vite process and the Rails proxy, so overriding it in both keeps them in agreement while avoiding the collision on `config/vite.json`'s port.
- Playwright sends mouse events to the page at viewport coordinates. A bounding box below the fold yields coordinates the page never receives, so the swipe silently does nothing. Scrolling the row into view first puts the coordinates back inside the viewport.

## Prevention

- **Before debugging a local browser-check failure as a regression, rule out environment state.** Ask: does this pass in CI, which starts clean? If so, reset the local environment first (restart Rails with the CI env, rebuild `/d/demo`) and re-run before reading the feature diff.
- **Start the local check server the way CI does.** A single command that mirrors `.github/workflows/ci.yml:151-162`:
  ```bash
  THINKROOM_DOC_CREATION_BURST=500 THINKROOM_DOC_CREATION_DAILY=500 PORT=3005 bin/dev
  ```
  Add `VITE_RUBY_PORT=<free port>` if another project already holds `:3036`.
- **Reset the demo document between batches of runs**, not just when something breaks:
  ```bash
  bin/rails runner 'Document.find_by(slug: "demo")&.destroy!' && bin/rails db:seed
  ```
- **Clear rate limits by restarting the server, not with `rails runner`.** In development the counters live in the server's memory store (`config/environments/development.rb:29`); a separate process cannot see them.
- **Write checks that tolerate a used demo doc where possible.** The browser check already moved from keyboard line selection to double-clicking its own typed sentinel because prior runs left images and empty lines at the document edges (`script/browser_check.mjs:2118-2122`). Anchor selections to text the check itself wrote, not to the demo document's original content.
- **Scroll before any coordinate-based gesture.** Any helper that uses `page.mouse.move/down/up` on a locator's bounding box should call `locator.scrollIntoViewIfNeeded()` first, especially under phone viewports where layout pushes content below the fold. Prefer locator actions (`locator.click()`, `locator.dragTo()`), which scroll automatically, when the gesture allows it.

## Related Issues

- No existing learning covers local browser-check setup.
- Issue #205 (flaky browser checks under CI load) is a different failure class: races under a busy CI runner, not local environment state.
