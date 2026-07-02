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

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await mounted(page)
  check(
    (await page.locator('[data-native-navbar="Thinkroom"]').count()) === 1,
    'home: native navbar signal present',
  )
  check(
    (await page.locator('[data-native-button][data-native-click="#new-document-button"]').count()) === 1,
    'home: native plus button targets #new-document-button',
  )
  check(
    (await page.locator('#new-document-button[data-native-haptic="impact"]').count()) === 1,
    'home: New document button carries an impact haptic',
  )

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await mounted(page)
  check((await page.locator('[data-native-navbar="Sign in"]').count()) === 1, 'login: native navbar signal present')
  check((await page.locator('[data-native-form]').count()) === 1, 'login: NativeForm marker present (back skips the form)')
  check(
    (await page.locator('input[name="remember_me"]').count()) === 0,
    'login: remember-me checkbox hidden (native sessions are always remembered)',
  )
  check(
    (await page.locator('button[type="submit"][data-native-haptic="impact"]').count()) >= 1,
    'login: submit carries an impact haptic',
  )

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
  await native.close()

  const web = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const webPage = await web.newPage()
  await webPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await mounted(webPage)
  check(
    (await webPage.locator('input[name="remember_me"]').count()) === 1,
    'web login: remember-me checkbox still present',
  )
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
