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
    if (msg.type() === 'error') errors[label].push(`${msg.text()} [${msg.location()?.url ?? ''}]`)
  })
  await page.goto(`${BASE}/d/${SLUG}`)
  return page
}

try {
  const a = await makePage('a')
  await a.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  await a.waitForSelector('.doc-status--live', { timeout: 10000 })
  ok('editor mounted and live in window A')

  const b = await makePage('b')
  await b.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  await b.waitForSelector('.doc-status--live', { timeout: 10000 })
  ok('editor mounted and live in window B')

  // Let the initial y-prosemirror binding render settle in both windows —
  // typing during the first sync churn can have its selection remapped.
  await a.waitForTimeout(2000)
  await b.waitForTimeout(200)

  // Markdown shortcut: ## + space makes an h2 while typing. Checked on a
  // fresh, single-client doc so no concurrent initial-sync churn can remap
  // the selection mid-keystroke (an artifact of synthetic typing speed, not
  // of human use).
  const created = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Shortcut check', markdown: 'Start here.' }),
    })
  ).json()
  const c = await browser.newPage()
  await c.goto(`${BASE}/d/${created.slug}`)
  await c.waitForSelector('.doc-status--live', { timeout: 15000 })
  await c.waitForTimeout(800)
  await c.click('.milkdown .ProseMirror')
  await c.keyboard.press('Meta+ArrowDown')
  await c.keyboard.press('Enter')
  await c.keyboard.type('## Shortcut heading check')
  const headingOk = await c
    .locator('.milkdown .ProseMirror h2', { hasText: 'Shortcut heading check' })
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (headingOk) ok('## markdown input shortcut produced an h2')
  else fail('## input rule did not produce a heading')
  await c.close()

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

  // --- Suggestion flow: Ask AI -> card in both windows -> accept -> merged ---
  const beforeAiSpans = await a.locator('.milkdown [data-kind="ai"]').count()
  await a.fill('.ask-ai-input', 'add a closing thought')
  await a.click('.ask-ai-button')
  await a.locator('.margin-card').first().waitFor({ timeout: 15000 })
  ok('Ask AI produced a pending suggestion card in window A')
  await b.locator('.margin-card').first().waitFor({ timeout: 10000 })
  ok('suggestion card appeared live in window B')

  const suggestionText = (await a.locator('.margin-card .margin-new').first().textContent())
    ?.trim()
    .slice(0, 40)
  const acceptedId = await a
    .locator('.margin-card')
    .first()
    .getAttribute('data-suggestion-id')
  await a.locator('.margin-card .btn-accept').first().click()
  await a.waitForFunction(
    (n) => document.querySelectorAll('.milkdown [data-kind="ai"]').length > n,
    beforeAiSpans,
    { timeout: 10000 },
  )
  ok('accepting merged the text with AI provenance in window A')

  await b.waitForFunction(
    (snippet) =>
      document.querySelector('.milkdown .ProseMirror')?.textContent?.includes(snippet),
    suggestionText,
    { timeout: 10000 },
  )
  ok('accepted suggestion text synced live to window B')

  await a.waitForFunction(
    (id) => !document.querySelector(`.margin-card[data-suggestion-id="${id}"]`),
    acceptedId,
    { timeout: 10000 },
  )
  ok('suggestion card cleared after accept (optimistic + reconcile)')

  // --- Comment flow: select text -> comment -> appears live -> resolve ---
  // Mouse-select a word in the sentinel paragraph typed above — keyboard
  // line-selection is brittle against demo-doc pollution from prior runs
  // (images and empty lines at the doc edges yield empty selections).
  await a.locator('.milkdown .ProseMirror p', { hasText: humanSentinel }).first().dblclick({ position: { x: 12, y: 10 } })
  await a.locator('.selection-toolbar').waitFor({ timeout: 5000 })
  ok('selection toolbar appears over selected text')
  await a.locator('.selection-toolbar button', { hasText: 'Comment' }).click()
  const commentBody = `Browser check comment ${Date.now()}`
  await a.fill('.comment-input', commentBody)
  await a.locator('.comment-composer button', { hasText: 'Comment' }).click()
  await a.locator('.comment-card', { hasText: commentBody }).waitFor({ timeout: 5000 })
  ok('comment posted (optimistic)')
  await b.locator('.comment-card', { hasText: commentBody }).waitFor({ timeout: 10000 })
  ok('comment appeared live in window B')

  await a
    .locator('.comment-card', { hasText: commentBody })
    .locator('.comment-resolve')
    .click()
  await b.waitForFunction(
    (text) =>
      !Array.from(document.querySelectorAll('.comment-card:not(.is-resolved)')).some((card) =>
        card.textContent?.includes(text),
      ),
    commentBody,
    { timeout: 10000 },
  )
  ok('resolve synced to window B')

  // --- Image upload: paste a PNG -> direct upload -> renders -> syncs ---
  // (paste exercises the same uploader as drop; synthetic DragEvents don't
  // route through ProseMirror's drop pipeline, real drops do)
  await a.click('.milkdown .ProseMirror')
  await a.evaluate(() => {
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const bytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'pixel.png', { type: 'image/png' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    document.querySelector('.milkdown .ProseMirror').dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer }),
    )
  })
  await a
    .locator('.milkdown img[src*="/rails/active_storage/blobs/"]')
    .first()
    .waitFor({ state: 'attached', timeout: 15000 })
  ok('pasted image uploaded via Active Storage and rendered inline')
  await b
    .locator('.milkdown img[src*="/rails/active_storage/blobs/"]')
    .first()
    .waitFor({ state: 'attached', timeout: 10000 })
  ok('image synced live to window B')

  // --- Theme switch: instant, persistent ---
  // The theme picker lives inside the Share popover since the header
  // consolidation — open it first.
  await a.locator('.share-button').click()
  await a.locator('.theme-option', { hasText: 'Whitey' }).click()
  const themeNow = await a.evaluate(() => document.documentElement.dataset.theme)
  if (themeNow === 'whitey') ok('theme switched instantly (optimistic, no reload)')
  else fail(`theme did not switch: ${themeNow}`)
  await a.reload()
  await a.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  const themeAfter = await a.evaluate(() => document.documentElement.dataset.theme)
  if (themeAfter === 'whitey') ok('theme persisted across reload')
  else fail(`theme lost on reload: ${themeAfter}`)
  await a.locator('.share-button').click()
  await a.locator('.theme-option', { hasText: 'Pruf' }).click()
  await a.keyboard.press('Escape')

  // --- Agent loop: an agent joins over plain HTTP while humans watch ---
  const agentHeaders = { 'X-Agent-Name': 'Scout', 'Content-Type': 'application/json' }
  const api = `${BASE}/api/docs/${SLUG}`

  // Cold discovery: fetch share URL like curl would
  const discovery = await fetch(`${BASE}/d/${SLUG}`, { headers: { 'User-Agent': 'curl/8.0' } })
  const guide = await discovery.text()
  if (guide.includes('X-Agent-Name') && guide.includes('/api/docs/')) {
    ok('cold fetch of the share URL surfaces the agent guide')
  } else {
    fail('share URL did not teach the agent how to participate')
  }

  await fetch(`${api}/presence`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ status: 'active', location: 'provenance' }),
  })
  await a.locator('.presence-agent', { hasText: 'Scout' }).first().waitFor({ timeout: 10000 })
  ok('agent presence chip appeared live')
  // Agent activity signal lives in the Share popover since the header
  // consolidation (the old standalone badge is gone).
  await a.locator('.share-button').click()
  await a.locator('.share-agent-dot.is-on').first().waitFor({ timeout: 5000 })
  await a.keyboard.press('Escape')
  ok('share popover shows the agent-active signal')
  await a.locator('.agent-cursor-label', { hasText: 'Scout' }).first().waitFor({ timeout: 5000 })
  ok('agent pseudo-cursor rendered at its work location')

  const suggestRes = await fetch(`${api}/suggestions`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({
      body: 'An agent-proposed closing paragraph.',
      intent: 'Add a closing',
      anchor_text: 'provenance',
    }),
  })
  if (suggestRes.status === 201) ok('agent proposed a suggestion over HTTP (201)')
  else fail(`agent suggestion failed: ${suggestRes.status}`)

  await b.locator('.margin-card .author-chip', { hasText: 'Scout' }).first().waitFor({ timeout: 10000 })
  ok('agent suggestion appeared live, agent-attributed')

  await fetch(`${api}/comments`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ body: 'Comment from the agent API.', anchor_text: 'markdown' }),
  })
  await b.locator('.comment-card .author-chip--agent', { hasText: 'Scout' }).first().waitFor({ timeout: 10000 })
  ok('agent comment appeared live, agent-attributed')

  await b.locator('.activity-row', { hasText: 'Scout' }).first().waitFor({ timeout: 5000 })
  ok('activity feed logged the agent actions')

  // Human accepts the agent suggestion; agent provenance lands in the doc
  await b.locator('.margin-card .btn-accept').first().click()
  await a.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.milkdown [data-provenance][data-kind="ai"]')).some(
        (el) => el.dataset.author === 'Scout',
      ),
    undefined,
    { timeout: 10000 },
  )
  ok('accepted agent text carries agent attribution in the document')

  // Agent reacts to the human: poll + ack events
  const events = await (await fetch(`${api}/events/pending`, { headers: agentHeaders })).json()
  if (events.events.some((e) => e.action === 'accepted_suggestion')) {
    ok('agent event polling saw the human acceptance')
  } else {
    fail('event polling missed the acceptance')
  }
  await fetch(`${api}/events/ack`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ last_event_id: events.ack_with }),
  })

  await fetch(`${api}/presence`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ status: 'done' }),
  })
  await a.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('.presence-agent')).some((el) =>
        el.textContent?.includes('Scout'),
      ),
    undefined,
    { timeout: 10000 },
  )
  ok('agent sign-off cleared its presence')

  // --- Suggest mode: type-to-suggest tracked changes (Google Docs parity) ---
  const trackDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Track changes check', markdown: 'Suggest target alpha beta gamma.' }),
    })
  ).json()
  const winA = await makePage('a')
  await winA.goto(`${BASE}/d/${trackDoc.slug}`)
  await winA.waitForSelector('.doc-status--live', { timeout: 15000 })
  const winB = await makePage('b')
  await winB.goto(`${BASE}/d/${trackDoc.slug}`)
  await winB.waitForSelector('.doc-status--live', { timeout: 15000 })
  await winA.waitForTimeout(1500)

  await winA.click('.mode-control-trigger')
  await winA.locator('.mode-control-option', { hasText: 'Suggest' }).click()
  const sugSentinel = `tracked-${Date.now()}`
  await winA.click('.milkdown .ProseMirror')
  await winA.keyboard.press('Meta+ArrowDown')
  await winA.keyboard.press('End')
  await winA.keyboard.type(` ${sugSentinel}`)

  const insLocal = await winA
    .locator('.milkdown ins.sug-ins', { hasText: sugSentinel })
    .first()
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (insLocal) ok('suggest-mode typing rendered as a tracked insertion (not a direct edit)')
  else fail('suggest-mode typing did not produce an insertion mark')

  await winB.waitForFunction(
    (s) =>
      Array.from(document.querySelectorAll('.milkdown ins.sug-ins')).some(
        (el) => el.textContent?.includes(s) && el.dataset.author,
      ),
    sugSentinel,
    { timeout: 10000 },
  )
  ok('tracked insertion synced live to window B with author attribution')

  // Remote client reviews the tracked edit from its margin card.
  // (Chip exclusion of pending insertions is display-only and exercised by
  // the accept assertions below — an all-human doc can't discriminate it.)
  await winB.locator('.margin-card--inline .btn-accept').first().click()
  await winB.waitForFunction(
    (s) => {
      const root = document.querySelector('.milkdown .ProseMirror')
      if (!root?.textContent?.includes(s)) return false
      const stillMarked = Array.from(document.querySelectorAll('.milkdown ins.sug-ins')).some(
        (el) => el.textContent?.includes(s),
      )
      const attributed = Array.from(
        document.querySelectorAll('.milkdown span[data-provenance][data-kind="human"]'),
      ).some((el) => el.textContent?.includes(s))
      return !stillMarked && attributed
    },
    sugSentinel,
    { timeout: 10000 },
  )
  ok('remote accept kept the text, dropped the tracking, and attributed it human')

  // Deletion: text stays struck-through until resolved; reject restores it.
  await winA.click('.milkdown .ProseMirror')
  await winA.keyboard.press('Meta+ArrowUp')
  await winA.keyboard.press('Home')
  for (let i = 0; i < 7; i += 1) await winA.keyboard.press('Shift+ArrowRight')
  await winA.keyboard.press('Backspace')
  await winA.locator('.milkdown del.sug-del', { hasText: 'Suggest' }).first().waitFor({ timeout: 5000 })
  ok('suggest-mode delete kept the text with a strikethrough deletion mark')
  await winB.locator('.milkdown del.sug-del', { hasText: 'Suggest' }).first().waitFor({ timeout: 10000 })
  await winB.locator('.margin-card--inline .btn-reject').first().click()
  await winB.waitForFunction(
    () =>
      !document.querySelector('.milkdown del.sug-del') &&
      document.querySelector('.milkdown .ProseMirror')?.textContent?.includes('Suggest target'),
    undefined,
    { timeout: 10000 },
  )
  ok('rejecting the deletion restored the text unmarked')

  // --- Comment mode: click-to-comment ---
  await winB.click('.mode-control-trigger')
  await winB.locator('.mode-control-option', { hasText: 'Comment' }).click()
  await winB.locator('.milkdown .ProseMirror p').first().click()
  await winB
    .locator('.selection-toolbar button', { hasText: 'Comment on this paragraph' })
    .waitFor({ timeout: 5000 })
  ok('comment-mode click on a paragraph offered the comment affordance')
  await winB.locator('.selection-toolbar button', { hasText: 'Comment on this paragraph' }).click()
  const clickComment = `Click-to-comment ${Date.now()}`
  await winB.fill('.comment-input', clickComment)
  await winB.locator('.comment-composer button', { hasText: 'Comment' }).click()
  await winA.locator('.comment-card', { hasText: clickComment }).waitFor({ timeout: 10000 })
  ok('click-to-comment posted and synced to the other window')

  await winA.close()
  await winB.close()

  // --- Demo doc: localStorage tampering cannot unlock suggest mode ---
  const demoPage = await browser.newPage()
  await demoPage.goto(`${BASE}/d/${SLUG}`)
  await demoPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  await demoPage.evaluate((slug) => localStorage.setItem(`pruf:mode:${slug}`, 'suggest'), SLUG)
  await demoPage.reload()
  await demoPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  const demoMode = (await demoPage.locator('.mode-control-trigger').textContent())?.trim()
  if (demoMode?.startsWith('Edit')) ok('demo doc ignored a tampered stored mode (locked to Edit)')
  else fail(`demo doc mode after tamper: "${demoMode}"`)
  await demoPage.close()

  for (const [label, errs] of Object.entries(errors)) {
    const fatal = errs.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Download the React DevTools') &&
        // Stale Active Storage blobs: prior runs paste images into the demo
        // doc whose blobs/variants no longer resolve — pollution, not a bug.
        !(e.includes('status of 404') && e.includes('/rails/active_storage/')),
    )
    if (fatal.length > 0) fail(`console errors in window ${label}:\n  ${fatal.join('\n  ')}`)
  }
  if (process.exitCode !== 1) console.log('\nAll browser checks passed.')
} catch (err) {
  fail(`browser check crashed: ${err.message}`)
} finally {
  await browser.close()
}
