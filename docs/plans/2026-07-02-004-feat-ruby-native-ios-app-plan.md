---
title: "feat: Ruby Native iOS app support"
type: feat
date: 2026-07-02
---

# feat: Ruby Native iOS app support

## Summary

Integrate [Ruby Native](https://rubynative.com/docs) (gem `ruby_native` ~> 0.10, npm `@ruby-native/react`) so Thinkroom can ship as a native iOS app that wraps the existing Rails + Inertia React frontend. The integration adds native detection, safe-area layout, a native navigation bar with buttons on the home and auth pages, haptic feedback on key interactions, always-on session persistence for native users, and OAuth hand-off through the system browser.

## Problem Frame

Thinkroom is web-only today. Ruby Native turns an existing Rails app into an App Store iOS app (Android in beta) by pointing a native shell at the site and reading signal elements from the DOM. The repo has strong mobile web UI (mobile dock, bottom sheets, safe-area padding) but zero native-bridge infrastructure: no native detection, no signal elements, no haptics, and the session/auth flow assumes a browser.

---

## Requirements

**Native shell wiring**

- R1. The `ruby_native` gem is installed with a `config/ruby_native.yml` tailored to Thinkroom (app name, brand tint/background colors, forced light theme, no tab bar, Google OAuth path), and `GET /native/config` serves it.
- R2. The layout carries `viewport-fit=cover` in the viewport meta tag and links the gem stylesheet so `native-hidden` and `native-inset-*` utility classes work.
- R3. Every Inertia page receives `nativeApp` (and `nativeForm`) shared props via `RubyNative::InertiaSupport`, and requests from non-native browsers see `nativeApp: false` with no behavior change.

**Native UI**

- R4. The home page (`documents/index`) renders a native navigation bar titled "Thinkroom" with a trailing plus button that triggers the existing "New document" action.
- R5. The auth page renders a native navigation bar and marks itself as a form (`NativeForm`) so native back navigation skips it; the "Remember me" checkbox is hidden in the native app.
- R6. The document page keeps its custom web header (mode control, presence, share) and gains a native back affordance plus correct safe-area insets in the native shell.
- R7. Key interactions carry haptic feedback data attributes: new document (impact), accept/reject suggestion actions (success/warning), Accept all (success), mode selection (selection), auth submit (impact).

**Auth & sessions**

- R8. Native app sign-ins (password, signup, and Google OAuth) are always remembered (30-day session), without changing web behavior where remember-me stays opt-in.
- R9. Google OAuth works from the native shell via the gem's system-browser flow (`auth.oauth_paths` config); the web OAuth flow is untouched.

**Quality**

- R10. Integration tests cover native UA detection, shared props, layout tags, the config endpoint, and forced remember-me for native sign-ins. `npm run check`, `bin/rubocop`, and `bin/rails test` pass.

---

## Key Technical Decisions

- **Use the official `ruby_native` gem + `@ruby-native/react` npm package, not hand-rolled signals:** the gem auto-includes `RubyNative::NativeDetection` into `ActionController::Base`, mounts its engine at `/native`, serves the utility stylesheet, and its data-attribute contract (`data-native-*`) is what the native shell actually reads. Hand-rolling would chase a moving contract.
- **Share native props from `InertiaController`:** include `RubyNative::InertiaSupport` in `app/controllers/inertia_controller.rb` (the Inertia base), matching the existing `inertia_share viewer:` pattern. The concern shares `nativeApp`/`nativeForm` on every Inertia page.
- **No tab bar:** Thinkroom is document-centric (home list + document editor); there is no second top-level destination. Omitting `tabs:` in `config/ruby_native.yml` hides the tab bar and launches at `/` (the gem's fallback entry path). A Profile/Settings tab is deferred until such a page exists.
- **Native navbar on home and auth only; document page keeps its web header:** the doc header (`doc-header`) carries mode control, connection status, presence, Accept all, and the share popover — chrome with no native-navbar equivalent. Replicating it would fork the editor UX. Home and auth have simple headers where the liquid-glass native bar plus a plus-button shines. The doc page instead gets the gem's custom back-button pattern (`native-back-button` class + `goBack()`), which the gem stylesheet shows only when history exists inside the native shell.
- **Haptics via data attributes, not JS calls:** `nativeHaptic(type)` from `@ruby-native/react` returns `{ "data-native-haptic": type }` spread onto buttons. Declarative, SSR-safe, zero-cost on web. A `window.RubyNative` global type is declared for future programmatic use but no runtime JS calls are added.
- **Force remember-me inside `complete_authentication`:** `app/controllers/concerns/authenticates_user.rb` is the single funnel for password, signup, and OAuth sign-ins. `remember: remember || native_app?` there satisfies the Ruby Native auth guidance ("always remember native users") for all three flows with one change — no hidden form fields.
- **Force `theme: light` in the native shell:** Thinkroom's two themes (`proof`, `whitey`) are both light; the web app has no OS dark mode. Forcing light prevents a dark status bar/window background mismatch. `background_color` matches `--surface` (`#faf8f4`), `tint_color` matches `--accent` (`#b65c3d`).
- **TypeScript declaration file for `@ruby-native/react`:** the package ships plain JS with no types; strict `tsc` would fail on import. A local `.d.ts` module declaration in `app/frontend/types/` types the components used.

---

## Scope Boundaries

Out of scope for this PR: no product behavior changes on the web (native chrome only appears under a Ruby Native user agent).

### Deferred to Follow-Up Work

- Push notifications (`native_push_tag`, `action_push_native`, `/native/push/devices`) — needs APNs setup.
- App icon badges, in-app review prompts, in-app purchases, permissions, FAB.
- App Store submission config (`ios.bundle_id`, `team_id`, linked domains / AASA) — requires Apple Developer Program enrollment values.
- Android (private beta upstream).
- Advanced Mode (native push/pop transitions) — requires a Stimulus bridge dependency; the app has no Stimulus.
- App Store screenshot automation (`ruby_native_screenshot_session?` determinism).

---

## Implementation Units

### U1. Gem install and native shell config

- **Goal:** Rails side of the integration — gem, config file, ignore rules.
- **Requirements:** R1, R9
- **Dependencies:** none
- **Files:** `Gemfile`, `Gemfile.lock`, `config/ruby_native.yml` (new), `.gitignore`
- **Approach:** `bundle add ruby_native`, then create `config/ruby_native.yml` by hand (the generator's template carries placeholder tabs we don't want): `app.mode: normal`, no `entry_path` (falls back to `/`), `appearance` with `tint_color: "#b65c3d"`, `background_color: "#faf8f4"`, `theme: light`, splash enabled with dark status bar, no `tabs:` key, and `auth.oauth_paths: ["/auth/google_oauth2"]`. Add `.ruby_native/` to `.gitignore`. Dev `config.hosts` already allows `.trycloudflare.com`, so skip the generator's host edit.
- **Patterns to follow:** template at the gem's `lib/generators/ruby_native/templates/ruby_native.yml`; option semantics per rubynative.com/docs/setup and /docs/appearance.
- **Test scenarios:**
  - `GET /native/config` returns JSON containing the app appearance (tint color) and no `tabs` key.
  - `GET /` with a normal browser UA renders unchanged (no native signal elements).
- **Verification:** engine routes respond in dev; `bin/rails test` still green.

### U2. Layout and controller wiring

- **Goal:** Head tags plus shared Inertia props for native detection.
- **Requirements:** R2, R3
- **Dependencies:** U1
- **Files:** `app/views/layouts/application.html.erb`, `app/controllers/inertia_controller.rb`, `test/integration/ruby_native_test.rb` (new)
- **Approach:** add `viewport-fit=cover` to the existing viewport meta tag; add `stylesheet_link_tag :ruby_native` next to the existing stylesheet tags. Include `RubyNative::InertiaSupport` at the top of `InertiaController` so `nativeApp`/`nativeForm` join the shared props alongside `viewer`.
- **Patterns to follow:** existing `inertia_share` block in `app/controllers/inertia_controller.rb`; Inertia testing helpers from `inertia_rails/minitest` (see `test/test_helper.rb`).
- **Test scenarios:**
  - `GET /` with UA `Thinkroom Ruby Native iOS RubyNative/1.0` → Inertia props include `nativeApp: true`.
  - `GET /` with a desktop Chrome UA → `nativeApp: false`.
  - Response body includes `viewport-fit=cover` and a `ruby_native` stylesheet link.
- **Verification:** integration tests pass; SSR pages (`/`, `/d/demo`) still render.

### U3. npm package and TypeScript types

- **Goal:** Frontend dependency plus type safety under strict `tsc`.
- **Requirements:** R4, R5, R7
- **Dependencies:** none
- **Files:** `package.json`, `package-lock.json`, `app/frontend/types/ruby_native.d.ts` (new), `app/frontend/types/index.ts`, `app/frontend/types/globals.d.ts`
- **Approach:** `npm install @ruby-native/react`. Write a module declaration typing `NativeNavbar`, `NativeButton`, `NativeForm`, and `nativeHaptic` (the surface this plan uses; extend later as needed). Add `nativeApp: boolean` to the shared props type so `usePage().props` picks it up, and declare an optional `window.RubyNative` global (`haptic`, `visit`, `postMessage`).
- **Patterns to follow:** existing declarations in `app/frontend/types/globals.d.ts`; shared props shape in `app/frontend/types/index.ts`.
- **Test scenarios:** Test expectation: none — type-only unit; covered by `npm run check`.
- **Verification:** `npm run check` passes with the new imports in use.

### U4. Native navbar and buttons (home + auth)

- **Goal:** Native navigation bars with working native buttons.
- **Requirements:** R4, R5
- **Dependencies:** U2, U3
- **Files:** `app/frontend/pages/documents/index.tsx`, `app/frontend/pages/auth/show.tsx`
- **Approach:** Home: render `NativeNavbar title="Thinkroom"` with a trailing `NativeButton icon="plus"` whose `click` targets a stable id added to the existing "New document" submit button — the native button reuses the web form's submission path (owner token, Inertia redirect) untouched. Auth: render `NativeNavbar` titled "Sign in"/"Create account" plus `NativeForm`, and hide the remember-me checkbox when `nativeApp` (U6 forces it server-side). Signal elements are hidden divs; render them unconditionally (the shell ignores them on web and the components return `hidden` elements).
- **Patterns to follow:** Inertia examples at rubynative.com/docs/navbar; `usePage().props` usage in existing pages.
- **Test scenarios:**
  - Home HTML (any UA) contains `data-native-navbar="Thinkroom"` and a `data-native-button` with `data-native-click` pointing at the new-document button id.
  - Auth HTML contains `data-native-form` and `data-native-navbar`.
  - With native UA, auth page hides the remember-me label (assert via `nativeApp` prop; visual check manual).
- **Verification:** signals present in DOM; web rendering unchanged visually (signal divs are `hidden`).

### U5. Haptics and document-page native affordances

- **Goal:** Tactile feedback on the interactions that define the app, plus back/safe-area polish on the editor.
- **Requirements:** R6, R7
- **Dependencies:** U3
- **Files:** `app/frontend/pages/documents/index.tsx`, `app/frontend/pages/documents/show.tsx`, `app/frontend/components/mode_control.tsx`, `app/frontend/components/margin_suggestions.tsx`, `app/frontend/components/review_popover.tsx`, `app/frontend/pages/auth/show.tsx`, `app/frontend/entrypoints/application.css`
- **Approach:** spread `nativeHaptic(...)` data attributes: `impact` on New document and auth submit, `success` on suggestion accept and Accept all, `warning` on suggestion reject, `selection` on mode-control options. On the document page header, add a `native-back-button`-classed button (calling `window.RubyNative`-backed `goBack` semantics via the gem's postMessage contract) before the `T.` home link; the gem stylesheet keeps it hidden outside the native shell. Add `native-inset-top` to `doc-header` and `native-inset-bottom` to the mobile dock so fixed chrome clears the Dynamic Island and home indicator (classes are no-ops on web where the CSS variables/env() resolve to 0).
- **Patterns to follow:** rubynative.com/docs/haptics and /docs/back-buttons Inertia examples; existing safe-area usage (`env(safe-area-inset-bottom)`) in `app/frontend/entrypoints/application.css`.
- **Test scenarios:**
  - Rendered home HTML: New document button carries `data-native-haptic="impact"`.
  - Document page HTML: Accept all button carries `data-native-haptic="success"`; header contains a `native-back-button` element.
  - Web view: back button not visible without the native shell (CSS default `display: none`).
- **Verification:** DOM attribute checks via integration test or Playwright UA-override script; no visual regression on web (manual browser pass).

### U6. Always-remember native sessions

- **Goal:** Native users stay signed in per Ruby Native auth guidance.
- **Requirements:** R8
- **Dependencies:** U1
- **Files:** `app/controllers/concerns/authenticates_user.rb`, `test/integration/ruby_native_test.rb`
- **Approach:** in `complete_authentication`, treat `native_app?` as an implicit remember: `session[:remember_me] = true if remember || native_app?`. Covers login, signup, and OAuth callback in one place. Web behavior unchanged (checkbox still opt-in).
- **Patterns to follow:** existing remember-me flow (`extend_remembered_session` in `app/controllers/application_controller.rb`, plan `docs/plans/2026-07-02-003-feat-remember-me-login-plan.md`).
- **Test scenarios:**
  - POST `/login` with native UA and no `remember_me` param → session carries `remember_me`, subsequent request gets extended cookie expiry.
  - POST `/login` with desktop UA and no `remember_me` param → not remembered.
  - POST `/signup` with native UA → remembered.
- **Verification:** integration tests green.

### U7. End-to-end verification

- **Goal:** Prove the native contract renders and the web experience is unregressed.
- **Requirements:** R10
- **Dependencies:** U1–U6
- **Files:** `test/integration/ruby_native_test.rb`
- **Approach:** finish the integration test file started in U2/U6; run `npm run check`, `bin/rubocop`, `bin/rails test`. Manual pass with `bin/dev`: a Playwright (or curl) check with UA `Ruby Native iOS RubyNative/1.0` asserting signal elements and `nativeApp: true`, and a normal-browser pass over home, auth, and `/d/demo` confirming no visible change.
- **Test scenarios:** covered by U1–U6 scenario lists; this unit executes them.
- **Verification:** all checks green; screenshots/video captured from the browser pass.

---

## Risks & Dependencies

- **Native shell contract drift:** the data-attribute contract is owned by the gem/app pair; pinning `ruby_native` ~> 0.10 and using its helpers/components (not hand-built divs where a component exists) keeps us on the supported surface.
- **True native chrome is untestable locally:** tab bar, navbar rendering, haptics, and back gestures only exist in the Ruby Native shell (`bundle exec ruby_native preview` on a physical device). Local verification stops at the DOM/props contract, which is exactly what the shell consumes.
- **Engine auto-mounts routes:** `/native/*` and `/.well-known/apple-app-site-association` are prepended by the engine. Route conflict risk is low (no existing `/native` routes) but the integration test asserts `/native/config` responds.
- **`allow_browser versions: :modern`:** WKWebView's Safari-equivalent UA passes the modern gate; the native UA marker is appended, not replacing the Mozilla UA. If preview testing ever shows a 406, add a UA allowance — deferred until observed.
- **OAuth in the shell:** the gem bridges GET → POST via `/native/auth/start` with a CSRF-protected auto-submitting form, so OmniAuth's POST-only + `omniauth-rails_csrf_protection` setup is compatible as-is. Real-device validation deferred to preview testing.
