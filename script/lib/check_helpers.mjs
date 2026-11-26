// Shared Playwright helpers for the browser check scripts (script/*.mjs).

// Wait for full hydration: the stack's data-phase flips to "live" only once
// the editor is interactive. The status dot (.doc-status--live) is optimistic
// — it is server-rendered "live" from the first byte and resolves on inert
// pre-hydration SSR chrome — so interaction tests must gate on this instead.
export const waitForLive = (page, timeout = 15000) =>
  page.waitForSelector('.doc-editor-stack[data-phase="live"]', { timeout })

// The home page is server rendered, so its rows and buttons are visible before
// they have handlers, and `load` can fire before hydration too. The feedback
// button renders only on the client, so it marks the page as interactive.
export const waitForHome = (page) =>
  page.locator('.feedback-button').waitFor({ state: 'attached' })

// The one viewer granted a document's seed may close or reload before applying
// it (a cold Vite cache reloads the page that warms it). Until the grant lapses
// after 30 seconds every other viewer gets a live but blank editor, so wait for
// the content itself.
export const openSeeded = async (page, url) => {
  const deadline = Date.now() + 45000
  for (;;) {
    await page.goto(url)
    await waitForLive(page)
    const seeded = await page
      .locator('.doc-live-editor .ProseMirror h1').first()
      .waitFor({ timeout: 3000 })
      .then(() => true, () => false)
    if (seeded) return
    if (Date.now() > deadline) throw new Error(`${url} is still blank after its seed grant lapsed`)
  }
}

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
