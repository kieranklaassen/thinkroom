---
title: "feat: Remember me for 30 days on login"
date: 2026-07-02
type: feat
depth: standard
origin: user request (follow-up on mobile audit branch)
---

# feat: Remember me for 30 days on login

## Summary

Login sessions currently die when the browser closes: the app uses Rails' encrypted cookie session store with no `expire_after`, so `session[:user_id]` lives in a browser-session cookie. Add a "Remember me" checkbox to the login form that, when checked, makes the session cookie persist for 30 days (sliding — activity extends the window). Implemented as a session flag plus a per-request `expire_after`, with no database migration and no separate token: the encrypted session cookie itself becomes persistent, which keeps Action Cable's session-cookie auth working unchanged.

---

## Problem Frame

- `SessionsController#create` → `complete_authentication` (in `app/controllers/concerns/authenticates_user.rb`) does `reset_session` then `session[:user_id] = user.id`. No expiry is configured anywhere, so the `_proof_session`-style cookie is a browser-session cookie.
- Rails only re-sends the session cookie when session data changes. The classic pitfall: setting `expire_after` only at login means any later session write (e.g. `session[:recent_slugs]` on document visits, `session[:display_name]`) re-issues the cookie *without* an expiry, silently downgrading it back to browser-session. The fix must therefore set `expire_after` on **every** request where the remembered flag is present, not just at login.
- Action Cable (`app/channels/application_cable/connection.rb`) resolves the user straight from the encrypted session cookie — a persistent session cookie means realtime auth survives browser restarts with zero cable changes. A token-based design would have needed an HTTP-first re-auth hop.

## Requirements

- R1: The login form shows a "Remember me for 30 days" checkbox (login mode only, unchecked by default).
- R2: Logging in with the box checked issues a session cookie that expires 30 days out; subsequent session-writing requests re-issue it with a fresh 30-day expiry (sliding window).
- R3: Logging in without the box keeps today's browser-session behavior.
- R4: Logout (`reset_session`) fully clears the remembered state; the next session cookie is a browser-session cookie again.
- R5: The checkbox renders correctly on mobile (390px) and does not regress the iOS-zoom browser check.

---

## Key Technical Decisions

1. **Session flag + per-request `expire_after`, not a DB remember token.** `complete_authentication` sets `session[:remember_me] = true` (after `reset_session`, so fixation rotation is preserved), and an `ApplicationController` after-action sets `request.session_options[:expire_after] = 30.days` whenever the flag is present. Running after the action means login (flag just set) gets a persistent cookie and logout (`reset_session` just cleared the flag) reverts to a browser-session cookie, with a single hook. No migration, no new cookie, no revocation surface beyond what logout already provides, and Action Cable keeps working. A DB token (Devise-style rememberable) adds server-side revocation but is disproportionate for this app's single-session cookie architecture.
2. **Sliding 30-day window.** Each session-writing request while remembered re-issues the cookie with a fresh 30 days. This is the standard "remember me" contract; a hard cap would log out active users mid-session.
3. **Login only.** Signup and Google OAuth keep browser-session behavior — the user asked for login, and OAuth has no form to carry the preference. Deferred below.
4. **Checkbox is absent-when-unchecked.** Inertia's `Form` uses FormData semantics, so the server reads `params[:remember_me].present?` — no hidden-field dance.
5. **Mobile zoom check learns to skip non-keyboard inputs.** The 390px sweep asserts all `input` elements ≥16px; checkboxes/radios never trigger iOS zoom (no keyboard), so the sweep filter excludes them rather than forcing a meaningless 16px font on a checkbox.

## Scope Boundaries

- **In scope:** login checkbox UI + styles, session persistence plumbing, logout clearing, integration tests, mobile-check filter fix.
- **Out of scope:** server-side session revocation ("log out other devices"), remember-me on signup, remember-me for Google OAuth (would need the preference stashed pre-redirect), configurable duration.
- **Deferred to follow-up work:** extending remember-me to signup and the OAuth callback if users ask for it.

---

## Implementation Units

### U1. Session persistence plumbing

**Goal:** A remembered login stays signed in for 30 sliding days; plain login and logout behave exactly as today.

**Requirements:** R2, R3, R4

**Dependencies:** none

**Files:**
- `app/controllers/concerns/authenticates_user.rb`
- `app/controllers/application_controller.rb`
- `app/controllers/sessions_controller.rb`
- `test/integration/authentication_flow_test.rb`

**Approach:** `complete_authentication(user, remember: false)` sets `session[:remember_me] = true` when remembering. `ApplicationController` gains a `REMEMBER_ME_DURATION = 30.days` constant and an after-action that applies `request.session_options[:expire_after]` whenever `session[:remember_me]` is set — this is what keeps later session writes from downgrading the cookie, and because it runs after the action it naturally covers login (flag just set) and logout (flag just cleared by `reset_session`). `SessionsController#create` passes `remember: params[:remember_me].present?`. `destroy` needs no change.

**Patterns to follow:** existing `complete_authentication` structure and its call sites (registrations and oauth callbacks pass no `remember:` and keep default behavior).

**Test scenarios:**
- Happy path: `post login_path` with `remember_me: "1"` → response session cookie carries an `expires` attribute ~30 days out; `session[:user_id]` set.
- Sliding: after a remembered login, a session-writing request (`post identity_path`) re-issues the session cookie with an `expires` attribute.
- Negative: login without `remember_me` → session cookie has no `expires` attribute.
- Logout: `delete logout_path` after a remembered login → `session[:user_id]` nil; a subsequent session-writing request issues a cookie without `expires`.
- Regression: existing login/logout/registration tests keep passing (flag defaults off everywhere else).

**Verification:** New integration tests pass; full `bin/rails test` green.

### U2. Login form checkbox

**Goal:** Login page offers "Remember me for 30 days"; signup does not.

**Requirements:** R1, R5

**Dependencies:** U1

**Files:**
- `app/frontend/pages/auth/show.tsx`
- `app/frontend/pages/auth/show.css`

**Approach:** In login mode only, render a checkbox row between the password field and the submit button: `<input type="checkbox" name="remember_me" value="1" />` inside a horizontal label. New `.auth-remember` styles follow the existing `.auth-fields` vocabulary (ink-soft text, small-but-readable size; the checkbox styled by `@tailwindcss/forms` base with an accent that matches the focus ring).

**Test scenarios:** Test expectation: UI covered by the browser check and manual walkthrough; the server behavior is covered by U1's integration tests.

**Verification:** Checkbox renders on `/login` and not `/signup`; checked state posts `remember_me=1`; mobile rendering verified at 390px.

### U3. Mobile check filter fix

**Goal:** The zoom regression check doesn't false-positive on the new checkbox (or future radios).

**Requirements:** R5

**Dependencies:** U2

**Files:**
- `script/mobile_zoom_check.mjs`

**Approach:** Extend the sweep's filter to skip input types that never summon the iOS keyboard (`checkbox`, `radio`) alongside the existing `hidden` exclusion.

**Test scenarios:** Check passes with the checkbox present; a sub-16px *text* input still fails (unchanged assertion logic).

**Verification:** `node script/mobile_zoom_check.mjs` passes against the running dev server with the checkbox rendered.

---

## Risks & Dependencies

- **Session-cookie assertions in integration tests** depend on reading `Set-Cookie` response headers; Rack 3 may return an array. The test helper must handle both shapes.
- **Silent downgrade regression risk** is the core risk this design addresses; the sliding test in U1 pins it.
- **30-day encrypted cookie** slightly widens the replay window for a stolen cookie; acceptable and standard (cookie is encrypted, httponly, SameSite=Lax, Secure in production), and logout still invalidates by rotation... note: cookie-store logout does not server-side-invalidate old cookies — that's true today for browser-session cookies too and out of scope.

## Deferred Implementation Notes

- Exact `Set-Cookie` parsing helper shape is implementation-time.
- Checkbox visual (native accent-color vs custom) decided against the rendered result on both themes.
