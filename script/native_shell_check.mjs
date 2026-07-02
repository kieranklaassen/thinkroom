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

  // Doc page first: opening it records the slug in the session's recents,
  // which the home trailing menu's "Open the demo" item renders from.
  await page.goto(`${BASE}/d/${SLUG}`, { waitUntil: 'networkidle' })
  await mounted(page)
  check(
    (await page.locator('.doc-header .native-back-button').count()) === 1,
    'doc: native back button rendered in the header',
  )
  check(
    !(await page.locator('.native-back-button').isVisible()),
    'doc: back button hidden until the shell signals history',
  )
  await page.evaluate(() => document.body.classList.add('can-go-back'))
  check(
    await page.locator('.native-back-button').isVisible(),
    'doc: back button appears once body.can-go-back is set',
  )
  const headerClearsNotch = await page.evaluate(() => {
    document.documentElement.style.setProperty('--ruby-native-safe-area-inset-top', '47px')
    const paddingTop = parseFloat(getComputedStyle(document.querySelector('.doc-header')).paddingTop)
    document.documentElement.style.removeProperty('--ruby-native-safe-area-inset-top')
    return paddingTop >= 47
  })
  check(headerClearsNotch, 'doc: header padding-top honors the shell safe-area variable at phone width')

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
  await webPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await mounted(webPage)
  check(
    (await webPage.locator('input[name="remember_me"]').count()) === 1,
    'web login: remember-me checkbox still present',
  )
  check(await webPage.locator('#auth-submit').isVisible(), 'web login: credentials submit button still visible')
  await webPage.goto(`${BASE}/d/${SLUG}`, { waitUntil: 'networkidle' })
  await mounted(webPage)
  check(
    !(await webPage.locator('.native-back-button').isVisible()),
    'web doc: native back button never visible',
  )
  await web.close()
} finally {
  await browser.close()
}
