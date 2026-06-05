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

  // Markdown shortcut: type ## heading in B
  await b.click('.milkdown .ProseMirror')
  await b.keyboard.press('Meta+ArrowDown')
  // Double Enter exits list context if the doc ends in a list
  await b.keyboard.press('Enter')
  await b.keyboard.press('Enter')
  await b.keyboard.type('## Shortcut heading check')
  try {
    await b
      .locator('.milkdown .ProseMirror h2', { hasText: 'Shortcut heading check' })
      .waitFor({ timeout: 5000 })
    ok('## markdown input shortcut produced an h2')
  } catch {
    fail('## input rule did not produce a heading')
  }
  // Reload A and confirm persistence
  await a.reload()
  await a.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  await a.waitForFunction(
    (s) => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes(s),
    sentinel,
    { timeout: 10000 },
  )
  ok('content survived reload (server persistence works)')


  // --- Provenance checks ---
  const pendingAi = await a.locator('.milkdown .prov--ai.prov--pending').count()
  if (pendingAi > 0) ok('seeded AI spans render with pending tint')
  else fail('no pending AI spans found — seed provenance did not round-trip')

  // Typed text gets human attribution in the DOM of the other window
  const humanSentinel = `human-${Date.now()}`
  await a.click('.milkdown .ProseMirror')
  await a.keyboard.press('Meta+ArrowDown')
  await a.keyboard.press('Enter')
  await a.keyboard.type(humanSentinel)
  await b.waitForFunction(
    (s) =>
      Array.from(document.querySelectorAll('.milkdown span[data-provenance][data-kind="human"]')).some(
        (el) => el.textContent?.includes(s),
      ),
    humanSentinel,
    { timeout: 10000 },
  )
  ok('typed text carries human provenance across clients')

  // Summary chip reflects mixed provenance
  const summaryText = await a.locator('.prov-summary').textContent({ timeout: 5000 })
  if (summaryText?.includes('% human') && summaryText.includes('% AI')) {
    ok(`provenance summary live: "${summaryText.trim()}"`)
  } else {
    fail(`summary chip missing or malformed: "${summaryText}"`)
  }

  // Reload keeps AI tints (marks persist through the Yjs doc)
  await b.reload()
  await b.waitForSelector('.milkdown .prov--ai.prov--pending', { timeout: 15000 })
  ok('AI provenance tints survive reload')

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
