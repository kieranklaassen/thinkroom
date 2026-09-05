// Ruby Native shell contract check: the iOS/Android shell reads hidden
// data-native-* signal elements and haptic data attributes from the DOM,
// and the server keys nativeApp/nativeForm props off the "Ruby Native" UA
// marker. These are rendered client-side by React, so server-side tests
// can't see them — this check loads the pages the way the shell would and
// asserts the contract, plus that none of it leaks into the regular web UI.
//
//   BASE_URL=http://localhost:3000 SLUG=demo node script/native_shell_check.mjs
//
import { chromium } from 'playwright'
import { waitForLive } from './lib/check_helpers.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SLUG = process.env.SLUG ?? 'demo'

// WKWebView UA with the Ruby Native marker appended, as the iOS shell sends.
// The base must stay a modern Safari string so `allow_browser versions:
// :modern` keeps accepting it.
const NATIVE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1 Ruby Native iOS RubyNative/1.0'

const ok = (msg) => console.log(`✓ ${msg}`)
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}
const check = (condition, msg) => (condition ? ok(msg) : fail(msg))

const mounted = (page) =>
  page.waitForFunction(() => (document.getElementById('app')?.childElementCount ?? 0) > 0)

const browser = await chromium.launch()
try {
  const native = await browser.newContext({
    userAgent: NATIVE_UA,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await native.newPage()
  // Guided review remains reachable when the web header is hidden.
  const reviewFixtureResponse = await fetch(`${BASE}/api/docs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Name': 'Native reviewer' },
    body: JSON.stringify({ content: '# Native review\n\nRead this passage before endorsing it.' }),
  })
  if (!reviewFixtureResponse.ok) throw new Error(`native review fixture: ${reviewFixtureResponse.status}`)
  const reviewFixture = await reviewFixtureResponse.json()
  const guided = await native.newPage()
  guided.on('pageerror', (error) => fail(`native guided review page error: ${error}`))
  await guided.goto(`${BASE}/d/${reviewFixture.slug}/edit`); await waitForLive(guided)
  await guided.evaluate(() => {
    document.documentElement.style.setProperty('--ruby-native-safe-area-inset-top', '47px')
    document.documentElement.style.setProperty('--ruby-native-safe-area-inset-bottom', '34px')
  })
  const pendingNavigation = guided.locator('.prov-summary-compact').getByRole('button', { name: /Find next unreviewed/ })
  await pendingNavigation.tap()
  const guidance = guided.getByRole('dialog', { name: 'Review AI text' })
  await guidance.waitFor({ state: 'visible' })
  const guidanceBox = await guidance.boundingBox()
  check(guidanceBox.y >= 47 && guidanceBox.y + guidanceBox.height <= 810, 'native: guided review clears safe areas')
  const nextAction = guidance.getByRole('button', { name: 'Mark reviewed', exact: true })
  check((await nextAction.boundingBox()).height >= 44, 'native: review actions have touch-sized targets')
  await nextAction.tap()
  await guidance.getByRole('button', { name: 'Endorse', exact: true }).tap()
  await guidance.getByRole('button', { name: 'Done', exact: true }).tap()
  for (let i = 0; i < 4; i++) {
    await pendingNavigation.tap()
    if (await guided.getByRole('status').filter({ hasText: 'All caught up' }).isVisible()) break
    await guidance.getByRole('button', { name: 'Mark reviewed', exact: true }).tap()
    await guidance.getByRole('button', { name: 'Close', exact: true }).tap()
  }
  check(await guided.getByRole('status').filter({ hasText: 'All caught up' }).isVisible() && await guidance.count() === 0,
    'native: zero pending passages announce completion without stale guidance')
  await guided.close()

  // Doc page first: opening it records the slug in the session's recents,
  // which the home trailing menu's "Open the demo" item renders from.
  await page.goto(`${BASE}/d/${SLUG}`, { waitUntil: 'networkidle' })
  await mounted(page)
  check(
    (await page.locator('html[data-native-app]').count()) === 1,
    'native: html carries data-native-app (server-rendered)',
  )
  check(
    (await page.locator('[data-native-navbar]').count()) === 1 &&
      (await page.locator('[data-native-navbar]').getAttribute('data-native-navbar')) !== '',
    'doc: native navbar signal present with the document title',
  )
  check(
    (await page.locator('[data-native-button][data-native-position="leading"][data-native-click="#native-doc-back"]').count()) === 1,
    'doc: leading navbar button delegates to the back bridge',
  )
  check(
    (await page.locator('[data-native-button][data-native-share]').count()) === 1,
    'doc: native share button present (share sheet for the doc URL)',
  )
  check(
    (await page.locator('[data-native-menu-item][data-native-click^="#native-mode-"]').count()) === 0,
    'doc: demo is mode-locked, so the menu offers no mode items',
  )
  check(
    (await page.locator('[data-native-menu-item][data-native-click^="#native-export-"]').count()) === 2,
    'doc: menu offers Export Markdown and Export HTML',
  )
  check(
    (await page.locator('[data-native-menu-item][data-native-href="/"]').count()) === 1,
    'doc: menu offers Home',
  )
  const bridgeUsable = await page.evaluate(() => {
    const back = document.querySelector('#native-doc-back')
    if (!back) return false
    const style = getComputedStyle(back)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
  check(bridgeUsable, 'doc: back bridge control is clip-hidden, never display:none')
  check(
    !(await page.locator('.doc-header').isVisible()),
    'doc: web header hidden inside the native shell',
  )
  // The navbar's leading button owns back in native now (the web header is
  // hidden), so the old header back-button visibility checks are superseded.
  const bodyClearsNotch = await page.evaluate(() => {
    document.documentElement.style.setProperty('--ruby-native-safe-area-inset-top', '47px')
    const before = getComputedStyle(document.querySelector('.doc-page'), '::before')
    const height = parseFloat(before.height)
    document.documentElement.style.removeProperty('--ruby-native-safe-area-inset-top')
    return height >= 47
  })
  check(bodyClearsNotch, 'doc: body inset honors the shell safe-area variable with the header hidden')

  check(
    await page.locator('[data-native-menu-item][data-native-click="#native-theme-open"]').count() === 1,
    'doc: native menu offers document appearance',
  )
  await page.evaluate(() => document.querySelector('#native-theme-open')?.click())
  const themeDialog = page.getByRole('dialog', { name: 'Document theme', exact: true })
  await themeDialog.waitFor({ timeout: 5000 })
  check(await themeDialog.locator('kbd').innerText() === '⌘/Ctrl ⇧ .', 'native: appearance labels the same keyboard shortcut')
  await themeDialog.getByRole('radio', { name: /Whitey/ }).tap()
  check(await page.locator('html').getAttribute('data-theme') === 'whitey', 'native: touch theme selection applies immediately')
  await page.reload({ waitUntil: 'networkidle' })
  await waitForLive(page)
  check(await page.locator('html').getAttribute('data-theme') === 'whitey', 'native: selected theme survives refresh')
  await page.evaluate(() => document.querySelector('#native-theme-open')?.click())
  await page.getByRole('radio', { name: /Thinkroom/ }).tap()
  await page.getByRole('button', { name: 'Close', exact: true }).tap()

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await mounted(page)
  check(
    (await page.locator('[data-native-navbar="Thinkroom"]').count()) === 1,
    'home: native navbar signal present',
  )
  const leading = page.locator('[data-native-button][data-native-position="leading"]')
  check((await leading.count()) === 1, 'home: leading account menu button present')
  check(
    (await leading
      .locator('[data-native-menu-item][data-native-title="Sign in"][data-native-href="/login?return_to=%2F"]')
      .count()) === 1,
    'home: guest account menu offers Sign in',
  )
  const trailing = page.locator('[data-native-button][data-native-position="trailing"]')
  check((await trailing.count()) === 1, 'home: trailing actions menu button present')
  check(
    (await trailing
      .locator('[data-native-menu-item][data-native-title="Have an agent start one"][data-native-click="#agent-start-trigger"]')
      .count()) === 1,
    'home: actions menu triggers the agent start reveal',
  )
  check(
    (await trailing
      .locator('[data-native-menu-item][data-native-title="Open the demo"][data-native-href="/d/demo"]')
      .count()) === 1,
    'home: actions menu links the demo once it is in recents',
  )
  check(
    (await trailing
      .locator('[data-native-menu-item][data-native-title="Send feedback"][data-native-click=".feedback-button button"]')
      .count()) === 1,
    'home: actions menu triggers feedback recording',
  )
  check(
    (await page.locator('.feedback-button button').count()) === 1,
    'home: feedback menu click target resolves to exactly one button',
  )
  check(
    (await page.locator('[data-native-fab][data-native-icon="plus"][data-native-click="#new-document-button"]').count()) === 1,
    'home: FAB creates a new document via #new-document-button',
  )
  check(
    (await page.locator('[data-native-button][data-native-click="#new-document-button"]').count()) === 0,
    'home: navbar plus button removed (the FAB replaces it)',
  )
  check(
    (await page.locator('#new-document-button[data-native-haptic="impact"]').count()) === 1,
    'home: New document button carries an impact haptic',
  )
  check(
    !(await page.locator('.landing-wordmark').isVisible()),
    'home: hero title hidden in native (the nav bar already says Thinkroom)',
  )
  const landingClearsBar = await page.evaluate(() => {
    document.documentElement.style.setProperty('--ruby-native-safe-area-inset-top', '47px')
    const paddingTop = parseFloat(getComputedStyle(document.querySelector('.landing')).paddingTop)
    document.documentElement.style.removeProperty('--ruby-native-safe-area-inset-top')
    return paddingTop >= 47
  })
  check(landingClearsBar, 'home: landing keeps top spacing below the native bar')

  // Behavioral leg on a throwaway doc (the demo is mode-locked): create one,
  // prove the mode bridge works, then swipe-to-delete it from home.
  await page.evaluate(() => document.querySelector('#new-document-button')?.click())
  await page.waitForURL(/\/d\/[A-Za-z0-9]+\/edit/, { timeout: 30000 })
  await mounted(page)
  const throwawaySlug = await page.evaluate(() => window.location.pathname.split('/')[2])
  check(
    (await page.locator('[data-native-menu-item][data-native-click^="#native-mode-"]').count()) >= 2,
    'doc: unlocked doc offers mode menu items',
  )
  check(
    (await page.locator('[data-native-menu-item][data-native-click^="#native-mode-"][data-native-selected]').count()) === 1,
    'doc: exactly one mode menu item is marked selected',
  )
  check(
    (await page.locator('[data-native-menu-item][data-native-click="#native-toggle-activity"]').count()) === 1,
    'doc: menu offers Activity outside Read mode',
  )
  await page.evaluate(() => document.querySelector('#native-toggle-activity')?.click())
  const activityDialog = page.getByRole('dialog', { name: 'Activity', exact: true })
  await activityDialog.getByRole('button', { name: 'Agents', exact: true }).tap()
  await page.reload()
  await waitForLive(page)
  await page.evaluate(() => document.querySelector('#native-toggle-activity')?.click())
  check(
    await activityDialog.getByRole('button', { name: 'Agents', exact: true }).getAttribute('aria-pressed') === 'true',
    'native: activity filter survives refresh and opens from the bridge',
  )
  await activityDialog.getByRole('button', { name: 'Close', exact: true }).tap()
  await page.evaluate(() => document.querySelector('#native-mode-read')?.click())
  await page.waitForFunction(() => document.querySelector('.doc-page')?.classList.contains('is-read-mode'))
  ok('doc: mode bridge button switches the editor to Read mode')
  await page.waitForFunction(
    () => !document.querySelector('[data-native-menu-item][data-native-click="#native-toggle-activity"]'),
  )
  ok('doc: Activity menu item drops out in Read mode')

  // Second throwaway doc for the multi-row swipe scenarios.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await mounted(page)
  await page.evaluate(() => document.querySelector('#new-document-button')?.click())
  await page.waitForURL(/\/d\/[A-Za-z0-9]+\/edit/, { timeout: 30000 })
  const secondSlug = await page.evaluate(() => window.location.pathname.split('/')[2])
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await mounted(page)

  const row = page.locator(`[data-swipe-row="${throwawaySlug}"]`)
  const rowB = page.locator(`[data-swipe-row="${secondSlug}"]`)
  check(
    (await row.count()) === 1 && (await rowB.count()) === 1,
    'home: owned rows are swipe-enabled in native',
  )
  check(
    (await row.locator('button[data-native-haptic="warning"]').count()) === 1,
    'home: swipe row carries a haptic Delete action',
  )
  const swipeOpen = async (target) => {
    const box = await target.boundingBox()
    if (!box) return
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width - 40, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 160, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(280)
  }
  await swipeOpen(row)
  check(
    (await page.locator(`[data-swipe-row="${throwawaySlug}"].is-open`).count()) === 1,
    'home: horizontal swipe reveals the Delete action',
  )
  check(
    new URL(page.url()).pathname === '/',
    'home: releasing a swipe does not navigate into the document',
  )
  await swipeOpen(rowB)
  check(
    (await page.locator(`[data-swipe-row="${secondSlug}"].is-open`).count()) === 1 &&
      (await page.locator(`[data-swipe-row="${throwawaySlug}"].is-open`).count()) === 0,
    'home: opening a second row closes the first',
  )
  // Tap the visible body of the open row (left of the revealed Delete
  // button): the capture-phase handler must close the row, not navigate.
  const openBox = await rowB.boundingBox()
  if (openBox) {
    await page.mouse.click(openBox.x + openBox.width - 140, openBox.y + openBox.height / 2)
  }
  await page.waitForTimeout(280)
  check(
    (await page.locator(`[data-swipe-row="${secondSlug}"].is-open`).count()) === 0 &&
      new URL(page.url()).pathname === '/',
    'home: tapping an open row closes it without navigating',
  )
  const vBox = await row.boundingBox()
  if (vBox) {
    await page.mouse.move(vBox.x + vBox.width / 2, vBox.y + vBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(vBox.x + vBox.width / 2, vBox.y + vBox.height / 2 + 80, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(280)
  }
  check(
    (await page.locator(`[data-swipe-row="${throwawaySlug}"].is-open`).count()) === 0,
    'home: vertical drag scrolls instead of opening the row',
  )
  await swipeOpen(row)
  await page.waitForSelector(`[data-swipe-row="${throwawaySlug}"].is-open`, { timeout: 10000 })
  page.once('dialog', (dialog) => void dialog.dismiss())
  await row.locator('button[data-native-haptic="warning"]').click()
  await page.waitForTimeout(500)
  check(
    (await page.locator(`[data-swipe-row="${throwawaySlug}"]`).count()) === 1,
    'home: declining the confirm keeps the document',
  )
  page.once('dialog', (dialog) => void dialog.accept())
  await row.locator('button[data-native-haptic="warning"]').click()
  await page.waitForFunction(
    (slug) => !document.querySelector(`[data-swipe-row="${slug}"]`),
    throwawaySlug,
    { timeout: 15000 },
  )
  ok('home: confirmed delete removes the document row')

  // Failure path: drop the signed owner_token cookie (context-level API
  // reaches the httponly cookie) so the server's real owned_by? check fails
  // on an existing doc — the genuine onError path: error renders, the row
  // snaps closed, the document stays listed.
  const savedCookies = (await native.cookies()).filter((cookie) => cookie.name === 'owner_token')
  await native.clearCookies({ name: 'owner_token' })
  await swipeOpen(rowB)
  await page.waitForSelector(`[data-swipe-row="${secondSlug}"].is-open`, { timeout: 10000 })
  page.once('dialog', (dialog) => void dialog.accept())
  await rowB.locator('button[data-native-haptic="warning"]').click()
  await page.waitForSelector('.document-delete-error[role="alert"]', { timeout: 15000 })
  ok('home: failed delete surfaces the error message')
  // The dropped-cookie trigger also re-scopes the yours list on the refused
  // redirect (the row vanishes as a trigger artifact, not product behavior),
  // so row persistence/re-close is device-pass territory; the server-side
  // survival is what this trigger can honestly prove.
  const survivedDelete = await page.evaluate(
    async (slug) => (await fetch(`/d/${slug}`, { method: 'HEAD' })).ok,
    secondSlug,
  )
  check(survivedDelete, 'home: failed delete leaves the document alive on the server')
  if (savedCookies.length > 0) await native.addCookies(savedCookies)

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await mounted(page)
  await swipeOpen(rowB)
  await page.waitForSelector(`[data-swipe-row="${secondSlug}"].is-open`, { timeout: 10000 })
  page.once('dialog', (dialog) => void dialog.accept())
  await rowB.locator('button[data-native-haptic="warning"]').click()
  await page.waitForFunction(
    (slug) => !document.querySelector(`[data-swipe-row="${slug}"]`),
    secondSlug,
    { timeout: 15000 },
  )
  ok('home: second throwaway cleaned up via swipe delete')

  // Editor link routing inside the shell: same-origin page links must
  // navigate the webview itself (the external browser context has none of
  // the app's cookies — a signed-in user would land on a logged-out
  // session), while cross-origin links and signed Active Storage file URLs
  // keep opening in a new browsing context (files self-authenticate via
  // their signature; external pages need the user's own browser sessions).
  const linkDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'native-shell-check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Native link routing check',
        content:
          '# Native link routing\n\n' +
          `[Same-origin page](${BASE}/d/${SLUG})\n\n` +
          '[External page](https://example.com/native-link-check)\n\n' +
          `[Stored file](${BASE}/rails/active_storage/blobs/redirect/native-check/file.pdf)\n`,
      }),
    })
  ).json()
  await page.goto(`${BASE}/d/${linkDoc.slug}`, { waitUntil: 'networkidle' })
  await waitForLive(page)

  await page.locator('.milkdown .ProseMirror a', { hasText: 'Same-origin page' }).click()
  await page.waitForURL(`${BASE}/d/${SLUG}`, { timeout: 10000 })
  ok('doc: same-origin page link navigates the webview (session carries)')

  await page.goto(`${BASE}/d/${linkDoc.slug}`, { waitUntil: 'networkidle' })
  await waitForLive(page)
  const externalPopup = native.waitForEvent('page', { timeout: 10000 })
  await page.locator('.milkdown .ProseMirror a', { hasText: 'External page' }).click()
  const externalPage = await externalPopup
  check(
    externalPage.url().startsWith('https://example.com/native-link-check') &&
      new URL(page.url()).pathname === `/d/${linkDoc.slug}`,
    'doc: cross-origin link still opens in a new browsing context',
  )
  await externalPage.close()

  const filePopup = native.waitForEvent('page', { timeout: 10000 })
  await page.locator('.milkdown .ProseMirror a', { hasText: 'Stored file' }).click()
  const filePage = await filePopup
  check(
    new URL(filePage.url()).pathname.startsWith('/rails/active_storage/') &&
      new URL(page.url()).pathname === `/d/${linkDoc.slug}`,
    'doc: signed file URL still opens in a new browsing context (self-authenticating)',
  )
  await filePage.close()

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await mounted(page)
  check(
    (await page.locator('[data-native-navbar="Sign in"][data-native-pull-to-refresh="false"]').count()) === 1,
    'login: native navbar present with pull-to-refresh disabled',
  )
  check((await page.locator('[data-native-form]').count()) === 1, 'login: NativeForm marker present (back skips the form)')
  check(
    (await page.locator('input[name="remember_me"]').count()) === 0,
    'login: remember-me checkbox hidden (native sessions are always remembered)',
  )
  check(
    (await page.locator('button[type="submit"][data-native-haptic="impact"]').count()) >= 1,
    'login: submit carries an impact haptic',
  )
  check(
    (await page.locator('[data-native-submit-button][data-native-title="Sign in"][data-native-click="#auth-submit"]').count()) === 1,
    'login: native navbar submit button scoped to #auth-submit',
  )
  check(
    (await page.locator('#auth-submit[type="submit"]').count()) === 1,
    'login: #auth-submit is the credentials submit button',
  )
  check(
    (await page.locator('form[action="/auth/google_oauth2"] #auth-submit').count()) === 0,
    'login: Google OAuth submit button does not collide with #auth-submit',
  )
  check(
    (await page.locator('input[type="email"][autocomplete="username"]').count()) === 1,
    'login: email field pairs with iOS credential autofill',
  )

  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' })
  await mounted(page)
  check(
    (await page.locator('[data-native-submit-button][data-native-title="Create account"][data-native-click="#auth-submit"]').count()) === 1,
    'signup: native submit button titled Create account',
  )
  check(
    (await page.locator('input[type="email"][autocomplete="email"]').count()) === 1,
    'signup: email field keeps contact autofill',
  )
  await native.close()

  const web = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const webPage = await web.newPage()
  await webPage.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await mounted(webPage)
  check(await webPage.locator('#new-document-button').isVisible(), 'web home: New document button visible')
  check((await webPage.locator('#agent-start-trigger').count()) === 1, 'web home: agent start trigger present')
  check(!(await webPage.locator('[data-native-fab]').isVisible()), 'web home: FAB signal never visible')
  check(
    (await webPage.locator('[data-native-menu-item]:visible').count()) === 0,
    'web home: native menu items never visible',
  )
  check(
    (await webPage.locator('html[data-native-app]').count()) === 0,
    'web: html never carries data-native-app',
  )
  check(await webPage.locator('.landing-wordmark').isVisible(), 'web home: hero title still visible')
  check((await webPage.locator('[data-swipe-row]').count()) === 0, 'web home: no swipe rows in the DOM')
  await webPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await mounted(webPage)
  check(
    (await webPage.locator('input[name="remember_me"]').count()) === 1,
    'web login: remember-me checkbox still present',
  )
  check(await webPage.locator('#auth-submit').isVisible(), 'web login: credentials submit button still visible')
  await webPage.goto(`${BASE}/d/${SLUG}`, { waitUntil: 'networkidle' })
  await mounted(webPage)
  check(await webPage.locator('.doc-header').isVisible(), 'web doc: header renders as on main')
  // Clip-hidden by design (1px box, clipped) — Playwright's :visible counts
  // any non-empty box, so measure the footprint instead.
  const bridgeFootprint = await webPage.evaluate(() => {
    const el = document.querySelector('.native-bridge')
    if (!el) return true
    const rect = el.getBoundingClientRect()
    return rect.width <= 1 && rect.height <= 1
  })
  check(bridgeFootprint, 'web doc: bridge strip occupies no visible space')

  // Web link routing is unchanged: same-origin page links keep opening in a
  // new tab outside the native shell.
  await webPage.goto(`${BASE}/d/${linkDoc.slug}`, { waitUntil: 'networkidle' })
  await waitForLive(webPage)
  const webPopup = web.waitForEvent('page', { timeout: 10000 })
  await webPage.locator('.milkdown .ProseMirror a', { hasText: 'Same-origin page' }).click()
  const webPopupPage = await webPopup
  check(
    new URL(webPopupPage.url()).pathname === `/d/${SLUG}` &&
      new URL(webPage.url()).pathname === `/d/${linkDoc.slug}`,
    'web doc: same-origin page link still opens a new tab',
  )
  await webPopupPage.close()
  await web.close()
} finally {
  await browser.close()
}
