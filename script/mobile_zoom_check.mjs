// Mobile audit check: iOS Safari zooms the whole page when a focused
// input/textarea computes to a font-size below 16px. The login form shipped
// at 0.9rem (14.4px), so signing in on a phone zoomed in and never zoomed
// back out. Every native text input must compute to >=16px on touch devices,
// and no audited page may overflow an iPhone-class viewport horizontally.
//
// Runs an emulated touch context (390x844, coarse pointer) so the
// `(hover: none), (pointer: coarse)` input rules apply. Usage:
//
//   BASE_URL=http://localhost:3000 SLUG=demo node script/mobile_zoom_check.mjs
//
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SLUG = process.env.SLUG ?? 'demo'
const MIN_FONT_PX = 16

const ok = (msg) => console.log(`✓ ${msg}`)
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}

const auditPage = async (page, path, { expectFields }) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  // Wait for Inertia/React to mount; auth pages must render their form.
  await page.waitForFunction(() => (document.getElementById('app')?.childElementCount ?? 0) > 0)
  if (expectFields) await page.waitForSelector('input:not([type=hidden])')

  const inputs = await page.evaluate(() => {
    const fields = [...document.querySelectorAll('input, textarea, select')]
    return fields
      .filter((field) => field.type !== 'hidden' && field.getClientRects().length > 0)
      .map((field) => ({
        label: `${field.tagName.toLowerCase()}[name=${field.name || field.className || '?'}]`,
        fontPx: parseFloat(getComputedStyle(field).fontSize),
      }))
  })

  const zoomers = inputs.filter((input) => input.fontPx < MIN_FONT_PX)
  if (zoomers.length > 0) {
    for (const input of zoomers) {
      fail(`${path}: ${input.label} is ${input.fontPx}px — below the ${MIN_FONT_PX}px iOS zoom threshold`)
    }
  } else {
    ok(`${path}: ${inputs.length} visible field(s), all >=${MIN_FONT_PX}px`)
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  if (overflow.scrollWidth > overflow.innerWidth) {
    fail(`${path}: horizontal overflow (${overflow.scrollWidth}px content in ${overflow.innerWidth}px viewport)`)
  } else {
    ok(`${path}: no horizontal overflow at ${overflow.innerWidth}px`)
  }
}

const browser = await chromium.launch()
try {
  // No Safari userAgent spoof: Rails `allow_browser versions: :modern`
  // rejects unrecognized/old UA strings, and the touch media queries key on
  // hasTouch/isMobile emulation rather than the UA.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()

  await auditPage(page, '/login', { expectFields: true })
  await auditPage(page, '/signup', { expectFields: true })
  await auditPage(page, '/', { expectFields: false })
  await auditPage(page, `/d/${SLUG}`, { expectFields: false })
} finally {
  await browser.close()
}
