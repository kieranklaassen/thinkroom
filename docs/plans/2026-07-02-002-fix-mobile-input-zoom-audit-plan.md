---
title: "fix: Stop iOS input auto-zoom and harden mobile input sizing"
date: 2026-07-02
type: fix
depth: standard
origin: user report (mobile audit request)
---

# fix: Stop iOS input auto-zoom and harden mobile input sizing

## Summary

Logging in on iOS zooms the page because the auth form inputs render at 0.9rem (≈14.4px) — iOS Safari auto-zooms any focused `input`/`textarea`/contenteditable whose font-size is below 16px. The same sub-16px pattern exists on every other native text input in the app (home tag editor, comment composers, identity chip). Fix the auth inputs unconditionally, enforce a 16px minimum on all other inputs for touch devices via the repo's existing coarse-pointer media-query pattern, and add an automated browser check so the regression can't return.

---

## Problem Frame

- **Report:** "if I log in on mobile it kind of zooms in" + a general request to audit mobile font sizes / layout.
- **Root cause (verified in code):** `.auth-fields input { font-size: 0.9rem; }` in `app/frontend/pages/auth/show.css`. 0.9rem ≈ 14.4px < 16px → iOS Safari zooms the viewport on focus and does not zoom back out on blur.
- **Audit findings (all native text inputs, computed at the 16px browser default):**
  - `.auth-fields input` — 14.4px (`app/frontend/pages/auth/show.css`) — login/signup email, password, name fields. **The reported bug.**
  - `.document-tag-editor input` — 12.5px (`app/frontend/entrypoints/application.css` ~line 558) — home page tag editor.
  - `.comment-input` — 12.8px (`application.css` ~line 2023) — comment composer textarea.
  - `.sheet-body .comment-input` — 14.4px (`application.css` ~line 3380) — mobile comment sheet composer.
  - `.identity-input` — 11.8px (`application.css` ~line 2872) — guest-name edit in the header.
- **Not affected:** the Milkdown editor surface (contenteditable) is already 1rem on mobile; buttons/links don't trigger zoom; the viewport meta tag is correct (`width=device-width,initial-scale=1`, no `maximum-scale` hack — keep it that way for accessibility).
- **Auth page also uses `min-height: 100vh`**, which over-measures under iOS Safari's dynamic toolbar; `100dvh` is the modern fix with `100vh` as fallback.
- Touch-target audit: auth inputs/buttons are already 2.75rem (44px) tall — good. The tag editor input and identity input are shorter (34px / ~28px) and should get a touch-height bump alongside their font bump.

## Requirements

- R1: Focusing any input on the login/signup page on iOS must not zoom the viewport (all auth inputs ≥16px computed).
- R2: All other native text inputs must compute to ≥16px on touch devices, without changing the compact desktop chrome.
- R3: No horizontal overflow on the auth pages or home page at iPhone-class widths (390px).
- R4: Regression coverage via the repo's existing Playwright check-script convention, wired into the CI `browser_checks` job.

---

## Key Technical Decisions

1. **Fix auth inputs unconditionally (1rem everywhere), not just on touch.** The auth card is a simple centered form; 16px inputs are standard form sizing on desktop too, and an unconditional rule is simpler than a fork. Labels/help text stay as-is (they are not zoom triggers).
2. **Gate the other input bumps behind `@media (hover: none), (pointer: coarse)`.** This matches the repo's existing touch-target pattern (44px rules in `application.css` ~line 4248) and leaves the intentionally-compact desktop chrome (12–14px inputs in rails/popovers) untouched. Narrow *desktop* windows keep the compact look; real touch devices — the only place auto-zoom happens — get 16px.
3. **Do not add `maximum-scale=1` / `user-scalable=no` to the viewport meta.** That suppresses the symptom by disabling user zoom — an accessibility regression. Font-size is the correct fix.
4. **New check script follows `script/*_check.mjs` conventions** (Playwright chromium, `BASE_URL` env, `✓`/`✗` output, non-zero exit on failure) and is appended to the CI `browser_checks` loop.

## Scope Boundaries

- **In scope:** input font-size/touch-height fixes listed above, auth `100dvh`, the new browser check, CI wiring.
- **Out of scope (audited, no change needed):** viewport meta tag, Milkdown editor font sizes (already ≥16px mobile), mobile dock/sheets (already 44px targets + safe-area insets), secondary text sizes (labels, hints — small but readable and not zoom triggers).
- **Deferred to follow-up work:** a broader typographic pass on sub-13px UI chrome text if the user wants larger secondary text on mobile; auth-page-specific responsive polish beyond the zoom fix.

---

## Implementation Units

### U1. Fix auth page inputs and viewport height

**Goal:** Login/signup no longer triggers iOS auto-zoom; auth card centers correctly under dynamic toolbars.

**Requirements:** R1, R3

**Dependencies:** none

**Files:**
- `app/frontend/pages/auth/show.css`

**Approach:** Change `.auth-fields input` `font-size` from `0.9rem` to `1rem`. Change `.auth-page` `min-height` to `100vh` fallback + `100dvh` override. No markup changes; `app/frontend/pages/auth/show.tsx` stays untouched.

**Test scenarios:** Covered by U3's browser check (computed font-size ≥16px on every auth input at an iPhone-class touch viewport; no horizontal overflow). No Ruby-side behavior change.

**Verification:** On a 390px touch viewport, `getComputedStyle` of email/password/name inputs reports ≥16px; the page has no horizontal scrollbar; desktop rendering still looks correct.

### U2. Enforce 16px minimum on remaining inputs for touch devices

**Goal:** No native text input anywhere in the app triggers iOS auto-zoom.

**Requirements:** R2

**Dependencies:** none

**Files:**
- `app/frontend/entrypoints/application.css`

**Approach:** In the existing touch-target section (or adjacent to it), add rules under `@media (hover: none), (pointer: coarse)` bumping `.document-tag-editor input`, `.comment-input` (covers the sheet variant via inheritance of the same class), and `.identity-input` to `font-size: 1rem`. Give `.document-tag-editor input` and `.identity-input` a `min-height: 2.75rem` touch height in the same block (matching the repo's 44px convention); let the tag-save button grow with the row if needed. Desktop rules stay untouched.

**Patterns to follow:** the existing `@media (hover: none), (pointer: coarse)` block in `application.css` (~line 4248) that sets 44px menu targets.

**Test scenarios:** Touch-context computed-style assertions in U3's check for the home tag editor input. Comment composer and identity input live behind auth/interaction state; verify manually via device-emulated browser testing (focus each, confirm ≥16px computed size and no zoom).

**Verification:** With Playwright device emulation (hasTouch/isMobile), computed font-size of each listed input is ≥16px; with a plain desktop context they keep their compact sizes.

### U3. Mobile zoom browser check + CI wiring

**Goal:** Automated regression coverage for R1–R3.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U1, U2

**Files:**
- `script/mobile_zoom_check.mjs` (new)
- `.github/workflows/ci.yml` (append check to the `browser_checks` loop)

**Approach:** Playwright chromium with an iPhone-class emulated context (390×844, `isMobile`, `hasTouch` — so `(hover: none), (pointer: coarse)` matches). Visit `/login` and `/signup`: assert every rendered `input`/`textarea` computes to ≥16px font-size and the document has no horizontal overflow (`document.documentElement.scrollWidth <= window.innerWidth`). Visit `/` (home): assert the same input sweep (tag editor input is auth-gated; sweep whatever inputs render anonymously) and no horizontal overflow. Follow `script/meta_refresh_check.mjs` conventions for structure, env vars, and output.

**Patterns to follow:** `script/meta_refresh_check.mjs` (script shape), `.github/workflows/ci.yml` `browser_checks` job (the `for check in …` loop).

**Test scenarios:**
- Happy path: all inputs on `/login`, `/signup` ≥16px → check passes.
- Regression: any input under 16px → `✗` line and exit code 1.
- Layout: horizontal overflow at 390px on any checked page → failure.

**Verification:** `node script/mobile_zoom_check.mjs` passes locally against `bin/dev`; the CI loop includes the new script name.

---

## Risks & Dependencies

- **Larger input text can change control heights/layout.** Auth inputs have a fixed 2.75rem min-height with modest padding, so 16px text fits; the tag-editor row wraps at ≤40rem already. Verify visually at 390px.
- **`100dvh` support:** all evergreen browsers ship it; keep the `100vh` line first as fallback.
- **The coarse-pointer media query also matches touch laptops.** Acceptable — 16px inputs on a touch-enabled laptop are fine, and this matches how the repo already gates 44px targets.

## Deferred Implementation Notes

- Exact placement of the new media-query block inside `application.css` (near the existing touch-target section) is an implementation-time choice.
- Whether the anonymous home page renders any input at all determines how much U3's home sweep asserts; the sweep is written generically so it holds either way.
