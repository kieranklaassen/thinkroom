// Focused HTML document regression check using Playwright.
// Usage: BASE_URL=http://localhost:3000 node script/html_document_check.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const AGENT_HEADERS = {
  'X-Agent-Name': 'HTML Check',
  'Content-Type': 'application/json',
}

const checks = []
const ok = (message) => {
  checks.push(message)
  console.log(`✓ ${message}`)
}
const assert = (condition, message, detail = '') => {
  if (!condition) throw new Error(`${message}${detail ? `: ${detail}` : ''}`)
  ok(message)
}

const browser = await chromium.launch()
const errors = []
let phase = 'boot'
const context = await browser.newContext()
const a = await context.newPage()
const b = await context.newPage()

for (const [label, page] of [
  ['a', a],
  ['b', b],
]) {
  page.on('pageerror', (error) =>
    errors.push(`${label} [${phase}]: ${error.stack ?? String(error)}`),
  )
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} [${phase}]: ${message.text()}`)
  })
}

try {
  const createdResponse = await fetch(`${BASE}/api/docs`, {
    method: 'POST',
    headers: AGENT_HEADERS,
    body: JSON.stringify({
      title: 'HTML regression check',
      format: 'html',
      content:
        '<h1>HTML field notes</h1><p>Original <strong>copy</strong>.</p>' +
        '<table><thead><tr><th style="text-align: center">Column</th></tr></thead>' +
        '<tbody><tr><td style="text-align: center">Centered</td></tr></tbody></table>' +
        '<script>window.__unsafe = true</script><img src="https://tracker.example/pixel.png">',
    }),
  })
  assert(createdResponse.status === 201, 'agent created an HTML document')
  const created = await createdResponse.json()
  assert(created.content_format === 'html', 'create response identifies HTML source')
  assert(created.normalized === true, 'unsafe HTML normalization is observable')
  assert(!created.content.includes('script') && !created.content.includes('tracker.example'), 'unsafe create markup was removed')

  phase = 'initial editor load'
  await a.goto(`${BASE}/d/${created.slug}`)
  await a.waitForSelector('.doc-status--live', { timeout: 15000 })
  await a.waitForSelector('.milkdown .ProseMirror h1', { timeout: 15000 })
  await a.waitForSelector('.milkdown .ProseMirror table.children', { timeout: 15000 })
  await b.goto(`${BASE}/d/${created.slug}`)
  await b.waitForSelector('.doc-status--live', { timeout: 15000 })
  await b.waitForSelector('.milkdown .ProseMirror h1', { timeout: 15000 })
  await b.waitForSelector('.milkdown .ProseMirror table.children', { timeout: 15000 })

  assert((await a.locator('.doc-format').textContent())?.trim() === 'HTML', 'editor labels the document as HTML')
  assert(
    (await a.locator('.milkdown .ProseMirror table.children').count()) === 1,
    'supported HTML structure rendered',
  )
  assert(
    (await a.locator('.milkdown td').getAttribute('style'))?.startsWith('text-align: center'),
    'constrained table alignment rendered',
  )

  phase = 'live edit'
  const syncSentinel = `html-sync-${Date.now()}`
  await a.locator('.milkdown .ProseMirror p').first().click()
  await a.keyboard.press('End')
  await a.keyboard.type(` ${syncSentinel}`)
  await b.waitForFunction(
    (sentinel) => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes(sentinel),
    syncSentinel,
    { timeout: 10000 },
  )
  ok('HTML edits converge live between clients')

  phase = 'rich paste'
  await a.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.setData(
      'text/html',
      '<p onclick="window.__paste = true" style="color:red">Pasted safe text' +
        '<img src="https://tracker.example/pixel.png"><script>bad()</script></p>',
    )
    document.querySelector('.milkdown .ProseMirror')?.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    )
  })
  await a.waitForFunction(
    () => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes('Pasted safe text'),
    { timeout: 5000 },
  )
  const pastedUnsafe = await a.locator(
    '.milkdown [onclick], .milkdown [style*="color"], .milkdown img[src*="tracker.example"], .milkdown script',
  ).count()
  assert(pastedUnsafe === 0, 'unsafe rich paste markup never entered the editor')

  phase = 'HTML suggestion acceptance'
  const suggestionResponse = await fetch(`${BASE}/api/docs/${created.slug}/suggestions`, {
    method: 'POST',
    headers: AGENT_HEADERS,
    body: JSON.stringify({
      body: '<p>Rewritten <em>copy</em>.</p>',
      replaces: 'Original copy.',
      intent: 'Rewrite the opening',
    }),
  })
  assert(suggestionResponse.status === 201, 'agent proposed an HTML replacement')
  await a.locator('.margin-card', { hasText: 'Rewrite the opening' }).waitFor({ timeout: 10000 })
  await a.locator('.margin-card', { hasText: 'Rewrite the opening' }).locator('.btn-accept').click()
  await b.waitForFunction(
    () => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes('Rewritten copy.'),
    { timeout: 10000 },
  )
  assert(
    (await b.locator('.milkdown [data-provenance][data-kind="ai"]', { hasText: 'Rewritten' }).count()) > 0,
    'accepted HTML suggestion retained agent provenance',
  )

  phase = 'stale suggestion'
  const staleResponse = await fetch(`${BASE}/api/docs/${created.slug}/suggestions`, {
    method: 'POST',
    headers: AGENT_HEADERS,
    body: JSON.stringify({
      body: '<p>Should not append.</p>',
      replaces: 'Text that is not present',
      intent: 'Stale replacement',
    }),
  })
  assert(staleResponse.status === 201, 'agent proposed a stale HTML replacement')
  const stale = await staleResponse.json()
  const staleCard = a.locator('.margin-card', { hasText: 'Stale replacement' })
  await staleCard.waitFor({ timeout: 10000 })
  await staleCard.locator('.btn-accept').click()
  await a.locator('.doc-notice').waitFor({ timeout: 5000 })
  const stateAfterStale = await (await fetch(`${BASE}/api/docs/${created.slug}`)).json()
  assert(
    stateAfterStale.pending_suggestions.some((suggestion) => suggestion.id === stale.suggestion.id),
    'missing replacement target stays pending',
  )
  assert(
    !stateAfterStale.plain_text.includes('Should not append.'),
    'missing replacement was not appended elsewhere',
  )

  phase = 'tracked HTML insertion'
  await a.locator('.mode-control-trigger').click()
  await a.locator('.mode-control-option', { hasText: 'Suggest' }).click()
  const trackedSentinel = `tracked-html-${Date.now()}`
  await a.locator('.milkdown .ProseMirror').click()
  await a.keyboard.press('Meta+ArrowDown')
  await a.keyboard.press('Enter')
  await a.keyboard.type(trackedSentinel)
  await a.locator('.milkdown ins.sug-ins', { hasText: trackedSentinel }).waitFor({ timeout: 5000 })
  await b.locator('.milkdown ins.sug-ins', { hasText: trackedSentinel }).waitFor({ timeout: 10000 })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await (await fetch(`${BASE}/api/docs/${created.slug}`)).json()
    if (snapshot.content.includes(trackedSentinel) && snapshot.content.includes('<ins')) break
    await a.waitForTimeout(250)
  }
  phase = 'tracked insertion reload'
  await a.reload()
  await a.waitForSelector('.doc-status--live', { timeout: 15000 })
  await a.locator('.milkdown ins.sug-ins', { hasText: trackedSentinel }).waitFor({ timeout: 10000 })
  ok('HTML tracked insertion survived snapshot and reload')

  let state
  for (let attempt = 0; attempt < 20; attempt += 1) {
    state = await (await fetch(`${BASE}/api/docs/${created.slug}`)).json()
    if (state.content.includes(trackedSentinel)) break
    await a.waitForTimeout(250)
  }
  assert(state.content_format === 'html', 'state response preserves HTML format')
  assert(!Object.hasOwn(state, 'markdown'), 'HTML state omits Markdown aliases')
  assert(state.content.includes('<ins'), 'canonical HTML snapshot preserved tracked markup')
  assert(!/script|onclick|tracker\.example|color:\s*red/i.test(state.content), 'canonical HTML snapshot remained sanitized')

  phase = 'late collaborator reload'
  await b.reload()
  await b.waitForSelector('.doc-status--live', { timeout: 15000 })
  await b.waitForFunction(
    (sentinel) => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes(sentinel),
    trackedSentinel,
    { timeout: 10000 },
  )
  ok('late reload restored the persisted HTML collaboration state')

  assert(errors.length === 0, 'browser run completed without console errors', errors.join('\n'))
  console.log(`\n${checks.length} HTML document checks passed.`)
} finally {
  await browser.close()
}
