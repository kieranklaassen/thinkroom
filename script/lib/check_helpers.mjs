// Shared Playwright helpers for the browser check scripts (script/*.mjs).

// Wait for full hydration: the stack's data-phase flips to "live" only once
// the editor is interactive. The status dot (.doc-status--live) is optimistic
// — it is server-rendered "live" from the first byte and resolves on inert
// pre-hydration SSR chrome — so interaction tests must gate on this instead.
export const waitForLive = (page, timeout = 15000) =>
  page.waitForSelector('.doc-editor-stack[data-phase="live"]', { timeout })

// Dev-environment console noise, verified not to reproduce on clean loads or
// in production builds (docs/dogfood-reports/2026-07-01-main-two-week-release-dogfood.md):
// - React's recoverable hydration de-opt fires when automation interacts
//   before hydration completes; clean Playwright loads show zero of these.
// - ResizeObserver's undelivered-notifications warning is benign browser
//   noise under automation-driven resizes.
// Scripts with additional expected noise pass their needles as `extras`.
const BASE_NOISE = [
  'Hydration failed because the server rendered',
  'ResizeObserver loop completed with undelivered notifications',
]

export const expectedBrowserNoise = (message, extras = []) =>
  BASE_NOISE.concat(extras).some((needle) => message.includes(needle))
