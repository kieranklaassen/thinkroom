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
// after 30 seconds every other writer keeps the server-painted preview, and it
// goes live only at its next retry, so outwait both before looking for content.
export const openSeeded = async (page, url) => {
  const deadline = Date.now() + 45000
  for (;;) {
    await page.goto(url)
    await waitForLive(page, 45000)
    const seeded = await page
      .locator('.doc-live-editor .ProseMirror h1').first()
      .waitFor({ timeout: 3000 })
      .then(() => true, () => false)
    if (seeded) return
    if (Date.now() > deadline) throw new Error(`${url} is still blank after its seed grant lapsed`)
    console.log(`! ${url} opened blank; waiting for its seed grant to lapse`)
  }
}

// Reload a document and wait until the server's sync has reached the page. The
// page starts from the last compacted state; edits made since then arrive with
// the sync frame, after the editor is already live.
export const reloadSynced = async (page) => {
  let deadline
  const synced = new Promise((resolve, reject) => {
    deadline = setTimeout(() => reject(new Error('no sync arrived after the reload')), 30000)
    const onSocket = (socket) => {
      if (!/\/cable(?:\?|$)/.test(socket.url())) return
      page.off('websocket', onSocket)
      socket.on('framereceived', ({ payload }) => {
        if (String(payload).includes('"type":"sync"')) resolve()
      })
    }
    page.on('websocket', onSocket)
  })
  await Promise.all([synced, page.reload().then(() => waitForLive(page))])
    .finally(() => clearTimeout(deadline))
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
