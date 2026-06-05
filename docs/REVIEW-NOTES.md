# Inertia Rails Skills Audit

Skills installed with `npx skills add cole-robertson/inertia-rails-skills`
(under `.agents/skills/`). Audited against `inertia-rails-best-practices`,
`inertia-rails-forms`, `inertia-rails-performance`, and
`inertia-rails-testing` on 2026-06-05.

## Violations found → fixed

1. **Asset versioning (setup-02)** — `config/initializers/inertia_rails.rb`
   evaluated `ViteRuby.digest` once at boot, so a stale digest would never
   force a fresh visit after assets change. **Fixed:** wrapped in a lambda.
2. **Internal navigation (nav-01)** — the header "P." home link was a raw
   `<a href="/">`, causing a full page load. **Fixed:** Inertia `<Link>`.
3. **Polling (perf-04)** — presence expiry used a hand-rolled `setInterval`
   + `router.reload`, losing `usePoll`'s background-tab throttling and
   lifecycle handling. **Fixed:** `usePoll(45000, { only: ['presences'],
   async: true }, { autoStart: false })`, started/stopped by agent count.
4. **Minitest Inertia assertions (test-02/test-06)** — the suite asserted an
   Inertia prop by grepping the HTML body. **Fixed:** added
   `require "inertia_rails/minitest"` to `test/test_helper.rb` and replaced
   the body grep with `assert_inertia_component` + `assert_inertia_props`.
5. **Input validation (sec-05/sec-06)** — `documents#snapshot` persisted raw
   `params[:spans]` and unbounded markdown. **Fixed:** per-span
   `permit(:kind, :author, :state, :chars, :text)`, span-count cap (2,000),
   and a 2 MB markdown ceiling (413 when exceeded).

Found during the same review (beyond the skills): background meta-channel
reloads could cancel an in-flight optimistic mutation, rolling back an
accept. All mutation visits and background reloads now use Inertia v3's
`async: true` so they never cancel each other.

## Already-passing rules worth noting

- Lambda props on the document page; partial reloads with `only:` everywhere
  (cable event → debounced `router.reload({ only: [event] })`).
- Inertia v3 `router.optimistic(cb).patch/post` on all four mutations with
  correct rollback semantics.
- Minimal props (`slice`/`as_props`), no AR objects or sensitive columns.
- PRG + `inertia: { errors: ... }` on failure paths; `useForm` with
  `processing`-disabled submit on the landing page; `<Link prefetch>`.
- No `useEffect`+fetch for page data — props only; remaining effects are
  UI-only (focus, awareness, cursors).
- `encrypt_history = true`; the raw-fetch helper sends the CSRF meta token.
- Raw `fetch` is used only for fire-and-forget side effects that never
  return Inertia responses (snapshot push, Ask AI trigger) — the forms skill
  recommends `useHttp` but does not forbid this.

## Conflicts (skill rules vs. Inertia v3 reality)

- The forms skill's optimistic example mutates `page.props`; the installed
  v3.3.1 API types the callback as `(props) => Partial<TProps>`. The app
  follows the real API.
- The best-practices manual `import.meta.glob` page-resolution example is
  superseded by the `@inertiajs/vite` plugin's `pages:` option (used here).
- The skills predate the inertia_cable pattern; live updates via
  ActionCable → partial reload are intentional, not a polling violation.

## Not addressed (noted)

- No Capybara system tests — UI-level accept/reject is covered by
  `script/browser_check.mjs` (33 Playwright checks) instead, which exercises
  the real two-window collaborative behavior a single-session system test
  cannot.

# Design critique pass (summary)

Critiqued every surface for hierarchy, spacing, alignment, states
(hover/focus/loading/empty/error), and motion. Changes applied:

- Agent pseudo-cursor label lifted off the text line (pill + surface ring +
  shadow + entrance animation) — previously collided with ascenders.
- `:focus-visible` outlines on all interactive controls.
- `prefers-reduced-motion` disables animations/transitions.
- Hairline separators between rail sections; consistent uppercase section
  headers with count accents.
- Suggestion cards: slide-in entrance, leave-transition before optimistic
  removal; accept/reject button hierarchy (solid vs. ghost).
- Calm, instructive empty states for suggestions, comments, and activity.
- Theme switching transitions background/ink smoothly; both themes restyle
  provenance tints and code blocks from one token system.
