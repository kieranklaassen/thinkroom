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

  // contenteditable focuses zoom on iOS too — the Milkdown editor surface
  // on document pages must hold the same floor as native fields. Inputs that
  // never summon the keyboard (checkboxes, radios, buttons) never zoom.
  const inputs = await page.evaluate(() => {
    const NO_KEYBOARD = ['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'image']
    const fields = [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
    return fields
      .filter((field) => !NO_KEYBOARD.includes(field.type) && field.getClientRects().length > 0)
      .map((field) => ({
        label: `${field.tagName.toLowerCase()}[name=${field.name || field.className.split(' ')[0] || '?'}]`,
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

// The page sweeps only see fields that render at load. The composer, tag
// editor, identity, and sketch-caption inputs mount behind interactions, so
// probe them with synthetic elements — this also proves the emulated context
// really matches the coarse-pointer media query the 16px rules live in.
const assertTouchRules = async (page) => {
  const probe = await page.evaluate((min) => {
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) {
      return ['emulated context does not match the coarse-pointer media query']
    }
    const failures = []
    const host = document.createElement('div')
    document.body.append(host)
    const probes = [
      ['comment composer', '<textarea class="comment-input"></textarea>'],
      ['tag editor', '<div class="document-tag-editor"><input></div>'],
      ['identity chip', '<input class="identity-input">'],
      ['sketch caption', '<figcaption class="thinkroom-sketch-caption"><input class="thinkroom-sketch-title"></figcaption>'],
    ]
    for (const [name, html] of probes) {
      host.innerHTML = html
      const field = host.querySelector('input, textarea')
      const fontPx = parseFloat(getComputedStyle(field).fontSize)
      if (fontPx < min) failures.push(`${name} input is ${fontPx}px on touch — below ${min}px`)
    }
    host.remove()
    return failures
  }, MIN_FONT_PX)

  if (probe.length > 0) {
    for (const message of probe) fail(message)
  } else {
    ok('interaction-gated inputs hold the 16px floor under the coarse-pointer rules')
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
  await assertTouchRules(page)
  await auditPage(page, '/signup', { expectFields: true })
  await auditPage(page, '/', { expectFields: false })
  await auditPage(page, `/d/${SLUG}`, { expectFields: false })
} finally {
  await browser.close()
}
