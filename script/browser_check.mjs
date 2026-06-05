// Two-window live-collaboration smoke check using Playwright.
// Usage: BASE_URL=http://localhost:4123 node script/browser_check.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SLUG = process.env.SLUG ?? 'demo'

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}
const ok = (msg) => console.log(`✓ ${msg}`)

const browser = await chromium.launch()
const errors = { a: [], b: [] }

const makePage = async (label) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (err) => errors[label].push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors[label].push(msg.text())
  })
  await page.goto(`${BASE}/d/${SLUG}`)
  return page
}

try {
  const a = await makePage('a')
  await a.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  ok('editor mounted in window A')

  const b = await makePage('b')
  await b.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  ok('editor mounted in window B')

  // Wait for both to reach live status
  await a.waitForSelector('.doc-status--live', { timeout: 10000 })
  await b.waitForSelector('.doc-status--live', { timeout: 10000 })
  ok('both windows report live connection')

  // Type a unique sentinel at the start of the doc in A
  const sentinel = `sync-${Date.now()}`
  await a.click('.milkdown .ProseMirror')
  await a.keyboard.press('Meta+ArrowUp')
  await a.keyboard.press('End')
  await a.keyboard.type(` ${sentinel}`)

  await b.waitForFunction(
    (s) => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes(s),
    sentinel,
    { timeout: 10000 },
  )
  ok('edit from A appeared live in B (CRDT sync works)')

  // Reload A and confirm persistence
  await a.reload()
  await a.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  await a.waitForFunction(
    (s) => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes(s),
    sentinel,
    { timeout: 10000 },
  )
  ok('content survived reload (server persistence works)')

  // Markdown shortcut: type ## heading in B
  await b.click('.milkdown .ProseMirror')
  await b.keyboard.press('Meta+ArrowDown')
  await b.keyboard.press('Enter')
  await b.keyboard.type('## Shortcut heading check')
  const headingCount = await b
    .locator('.milkdown .ProseMirror h2:has-text("Shortcut heading check")')
    .count()
  if (headingCount > 0) ok('## markdown input shortcut produced an h2')
  else fail('## input rule did not produce a heading')

  for (const [label, errs] of Object.entries(errors)) {
    const fatal = errs.filter((e) => !e.includes('favicon') && !e.includes('Download the React DevTools'))
    if (fatal.length > 0) fail(`console errors in window ${label}:\n  ${fatal.join('\n  ')}`)
  }
  if (process.exitCode !== 1) console.log('\nAll browser checks passed.')
} catch (err) {
  fail(`browser check crashed: ${err.message}`)
} finally {
  await browser.close()
}
