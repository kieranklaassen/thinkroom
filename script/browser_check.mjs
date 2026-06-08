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
const errors = { a: [], b: [], persist: [] }

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

  // Soft breaks: single newlines in seeded markdown must render as visible
  // line breaks (metadata blocks like **Date:** / **Source:** / **Goal:**),
  // the snapshot must round-trip them back to plain newlines unchanged, and
  // literal contexts (fenced code) must keep their newlines untouched.
  const softDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Soft break check',
        markdown:
          '# Soft breaks\n\n**Date:** 2026-06-07\n**Source:** transcripts\n**Goal:** sharper plugin\n\n```\ncode line one\ncode line two\n```\n',
      }),
    })
  ).json()
  // br[data-type="hardbreak"] comes from Milkdown's hardbreakAttr; update the
  // selector if a Milkdown upgrade renames it.
  const inspectSoftBreaks = () => {
    const p = Array.from(document.querySelectorAll('.milkdown .ProseMirror p')).find((el) =>
      el.textContent?.includes('Date:'),
    )
    const code = document.querySelectorAll('.milkdown .ProseMirror pre')
    return {
      brs: p ? p.querySelectorAll('br[data-type="hardbreak"]').length : -1,
      lines: p ? p.innerText.split('\n') : [],
      html: p ? p.innerHTML.slice(0, 200) : '(no metadata paragraph found)',
      codeBlocks: code.length,
      codeText: code[0]?.textContent ?? '',
    }
  }
  const assertSoftBreakRender = async (page, label) => {
    await page
      .waitForFunction(
        () => {
          const p = Array.from(document.querySelectorAll('.milkdown .ProseMirror p')).find((el) =>
            el.textContent?.includes('Date:'),
          )
          return p && p.querySelectorAll('br[data-type="hardbreak"]').length === 2
        },
        { timeout: 10000 },
      )
      .catch(() => null)
    const state = await page.evaluate(inspectSoftBreaks)
    if (
      state.brs === 2 &&
      state.lines.length === 3 &&
      state.lines[0].endsWith('2026-06-07') &&
      state.lines[2].startsWith('Goal:')
    ) {
      ok(`soft-break metadata block renders as three separate lines (${label})`)
    } else {
      fail(`soft breaks collapsed (${label}): brs=${state.brs} lines=${JSON.stringify(state.lines)} html=${state.html}`)
    }
    if (state.codeBlocks === 1 && state.codeText.includes('code line one') && state.codeText.includes('code line two')) {
      ok(`fenced code block kept literal newlines (${label})`)
    } else {
      fail(`code block mangled (${label}): blocks=${state.codeBlocks} text=${JSON.stringify(state.codeText.slice(0, 80))}`)
    }
  }
  const sb = await browser.newPage()
  await sb.goto(`${BASE}/d/${softDoc.slug}`)
  await sb.waitForSelector('.doc-status--live', { timeout: 15000 })
  await assertSoftBreakRender(sb, 'initial render')
  // The 900ms snapshot debounce resets on every update — poll the API until
  // the snapshot lands instead of gambling on a fixed sleep.
  const stripMarkup = (md) => (md ?? '').replace(/<\/?(?:span|ins|del)[^>]*>/g, '')
  const expectedMeta = '**Date:** 2026-06-07\n**Source:** transcripts\n**Goal:** sharper plugin'
  let softPlain = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const softState = await (await fetch(`${BASE}/api/docs/${softDoc.slug}`)).json()
    softPlain = stripMarkup(softState.markdown)
    if (softPlain.includes(expectedMeta)) break
    await sb.waitForTimeout(300)
  }
  if (softPlain.includes(expectedMeta)) {
    ok('soft breaks round-trip to plain newlines in the snapshot')
  } else {
    fail(`soft-break serialization drifted: ${JSON.stringify(softPlain.slice(0, 160))}`)
  }
  // Reload exercises the persisted-state reparse path (no drift on repeated
  // open/serialize cycles).
  await sb.reload()
  await sb.waitForSelector('.doc-status--live', { timeout: 15000 })
  await assertSoftBreakRender(sb, 'after reload')
  await sb.close()

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
      // Soft break in the body: acceptance parses through the same Milkdown
      // parser as seeding, so the two lines must render with a <br> between.
      body: 'An agent-proposed closing paragraph.\nWith a second proposed line.',
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

  const acceptedSoftBreakOk = await a
    .waitForFunction(
      () => {
        const p = Array.from(document.querySelectorAll('.milkdown .ProseMirror p')).find((el) =>
          el.textContent?.includes('An agent-proposed closing paragraph.'),
        )
        return (
          p &&
          p.querySelectorAll('br[data-type="hardbreak"]').length >= 1 &&
          p.innerText.split('\n').some((line) => line.startsWith('With a second proposed line.'))
        )
      },
      undefined,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false)
  if (acceptedSoftBreakOk) ok('accepted suggestion soft break renders as a separate line')
  else fail('soft break in accepted suggestion body collapsed into one line')

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

  // --- Floating chrome placement: measured, centered, never covering ---
  const placeDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Placement check',
        markdown: Array.from(
          { length: 12 },
          (_, i) =>
            `Placement paragraph number ${i} with enough words to span a comfortable line of prose in the editor.`,
        ).join('\n\n'),
      }),
    })
  ).json()
  const p = await makePage('a')
  await p.goto(`${BASE}/d/${placeDoc.slug}`)
  await p.waitForSelector('.doc-status--live', { timeout: 15000 })
  await p.waitForTimeout(1000)

  const selectionRect = () =>
    p.evaluate(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      const r = sel.getRangeAt(0).getBoundingClientRect()
      return r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
    })
  const boxesOverlap = (a, b) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

  // Centered over the selection, fully in-viewport, never covering it.
  await p.locator('.milkdown .ProseMirror p').nth(1).dblclick({ position: { x: 12, y: 10 } })
  const toolbar = p.locator('.selection-toolbar.is-placed')
  await toolbar.waitFor({ timeout: 5000 })
  await p.waitForTimeout(250) // entrance animation settles
  let tb = await toolbar.boundingBox()
  let sel = await selectionRect()
  const vp = p.viewportSize()
  if (tb && sel && vp) {
    const drift = Math.abs(tb.x + tb.width / 2 - (sel.x + sel.width / 2))
    if (drift <= Math.max(40, tb.width / 2)) ok('toolbar centers over the selection')
    else fail(`toolbar off-center by ${Math.round(drift)}px`)
    if (tb.x >= 0 && tb.y >= 0 && tb.x + tb.width <= vp.width && tb.y + tb.height <= vp.height) {
      ok('toolbar fully inside the viewport (measured clamp)')
    } else fail(`toolbar escapes the viewport: ${JSON.stringify(tb)}`)
    if (!boxesOverlap(tb, sel)) ok('toolbar does not cover the selected text')
    else fail('toolbar covers the selection')
  } else fail('could not measure toolbar/selection geometry')

  // First visible frame is final: position is stable across frames.
  const tbAgain = await (async () => {
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
    return toolbar.boundingBox()
  })()
  if (tb && tbAgain && Math.abs(tb.x - tbAgain.x) < 1 && Math.abs(tb.y - tbAgain.y) < 1) {
    ok('toolbar placement stable after reveal (no post-paint jump)')
  } else fail('toolbar moved after reveal')

  // Header flip: with the anchor line tight under the sticky header, the
  // toolbar moves below the selection instead of covering the header.
  await p.evaluate(() => {
    const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect()
    if (r) window.scrollBy(0, r.top - 58)
  })
  await p.waitForTimeout(200) // rAF-throttled reposition pass
  tb = await toolbar.boundingBox()
  sel = await selectionRect()
  if (tb && sel && tb.y >= sel.y + sel.height - 1) {
    ok('toolbar flips below the selection when the header blocks above')
  } else fail(`toolbar did not flip below: toolbar ${JSON.stringify(tb)} sel ${JSON.stringify(sel)}`)

  // Drag settle: no toolbar chasing the cursor mid-drag; one reveal on release.
  const dragPara = p.locator('.milkdown .ProseMirror p').nth(3)
  await dragPara.scrollIntoViewIfNeeded()
  const dragBox = await dragPara.boundingBox()
  await p.mouse.move(dragBox.x + 4, dragBox.y + 8)
  await p.mouse.down()
  let seenMidDrag = false
  for (let i = 1; i <= 6; i += 1) {
    await p.mouse.move(dragBox.x + 4 + i * 30, dragBox.y + 8, { steps: 2 })
    await p.waitForTimeout(40)
    if (await p.locator('.selection-toolbar').isVisible().catch(() => false)) seenMidDrag = true
  }
  if (!seenMidDrag) ok('toolbar held back while dragging a selection')
  else fail('toolbar appeared mid-drag')
  await p.mouse.up()
  await p.locator('.selection-toolbar.is-placed').waitFor({ timeout: 5000 })
  ok('toolbar revealed once on release at the settled position')

  // Anchored composer: visible and usable with the side panel hidden (the
  // old rail composer rendered into display:none), never covering its
  // anchor, clamped into the viewport even with the anchor near the bottom.
  await p.keyboard.press('Meta+\\')
  const anchorPara = p.locator('.milkdown .ProseMirror p').nth(5)
  await anchorPara.scrollIntoViewIfNeeded()
  await anchorPara.dblclick({ position: { x: 12, y: 10 } })
  await p.locator('.selection-toolbar.is-placed').waitFor({ timeout: 5000 })
  await p.locator('.selection-toolbar button', { hasText: 'Comment' }).first().click()
  const composer = p.locator('.comment-composer--anchored.is-placed')
  await composer.waitFor({ timeout: 5000 })
  ok('anchored composer visible with the side panel hidden')

  await p.evaluate(() => {
    // Push the anchor near the viewport bottom — the composer must clamp
    // or flip, staying fully visible without covering the anchored text.
    window.scrollBy(0, -Math.max(0, window.innerHeight * 0.6))
  })
  await p.waitForTimeout(200)
  const composerBox = await composer.boundingBox()
  const anchorBox = await anchorPara.boundingBox()
  if (composerBox && anchorBox && vp) {
    if (composerBox.y >= 0 && composerBox.y + composerBox.height <= vp.height) {
      ok('composer stays fully inside the viewport near the bottom edge')
    } else fail(`composer clipped by the viewport: ${JSON.stringify(composerBox)}`)
    if (!boxesOverlap(composerBox, anchorBox)) ok('composer does not cover its anchor paragraph')
    else fail('composer covers the anchored text')
  } else fail('could not measure composer/anchor geometry')

  const hiddenPanelComment = `Hidden panel comment ${Date.now()}`
  await p.fill('.comment-composer--anchored .comment-input', hiddenPanelComment)
  await p.locator('.comment-composer--anchored .btn-accept').click()
  await p.keyboard.press('Meta+\\')
  await p.locator('.comment-card', { hasText: hiddenPanelComment }).waitFor({ timeout: 10000 })
  ok('comment posted from the anchored composer landed in the rail')
  await p.close()

  // --- Resolve persistence: accept/reject/resolve must survive a refresh ---
  // (regression for the optimistic-id resolve 404 and silent non-persistence)
  const persistDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Persistence check',
        markdown: 'Persistence paragraph alpha bravo charlie delta echo foxtrot golf hotel.',
      }),
    })
  ).json()
  const seedSuggestion = (anchor) =>
    fetch(`${BASE}/api/docs/${persistDoc.slug}/suggestions`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'persistence rewrite', intent: 'check', anchor_text: anchor }),
    })
  await seedSuggestion('alpha')
  await seedSuggestion('bravo')

  const q = await makePage('persist')
  await q.goto(`${BASE}/d/${persistDoc.slug}`)
  await q.waitForSelector('.doc-status--live', { timeout: 15000 })
  await q.waitForTimeout(800) // initial Yjs bind + margin card placement settle

  // Accept one, reject the other; both decisions must survive a reload.
  await q.locator('.margin-card .btn-accept').first().click()
  await q.waitForFunction(() => document.querySelectorAll('.margin-card').length === 1, undefined, {
    timeout: 10000,
  })
  await q.locator('.margin-card .btn-reject').first().click()
  await q.waitForFunction(() => document.querySelectorAll('.margin-card').length === 0, undefined, {
    timeout: 10000,
  })
  await q.reload()
  await q.waitForSelector('.doc-status--live', { timeout: 15000 })
  await q.waitForTimeout(800) // post-reload card re-derivation settle
  const cardsBack = await q.locator('.margin-card').count()
  if (cardsBack === 0) ok('accepted and rejected suggestions stayed resolved across reload')
  else fail(`${cardsBack} resolved suggestion card(s) reappeared after reload`)

  // A freshly posted (optimistic) comment must not offer Resolve until the
  // server id arrives — hold the POST open to keep the optimistic window.
  let commentPostHeld = false
  await q.route('**/comments', async (route) => {
    // Hold only the FIRST comment-creation POST; anything else (and any
    // later POST) passes through untouched so a background request can't
    // consume the delay meant for the optimistic window.
    if (route.request().method() !== 'POST' || commentPostHeld) {
      await route.continue()
      return
    }
    commentPostHeld = true
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })
  await q.locator('.milkdown .ProseMirror p').first().dblclick({ position: { x: 12, y: 10 } })
  await q.locator('.selection-toolbar.is-placed').waitFor({ timeout: 5000 })
  await q.locator('.selection-toolbar button', { hasText: 'Comment' }).first().click()
  const persistComment = `Persistence comment ${Date.now()}`
  await q.fill('.comment-composer--anchored .comment-input', persistComment)
  await q.locator('.comment-composer--anchored .btn-accept').click()
  await q.locator('.comment-card', { hasText: persistComment }).waitFor({ timeout: 2000 })
  const resolveDuringWindow = await q
    .locator('.comment-card', { hasText: persistComment })
    .locator('.comment-resolve')
    .count()
  if (resolveDuringWindow === 0) ok('optimistic comment hides Resolve until the server id arrives')
  else fail('Resolve offered on an optimistic comment (would PATCH a negative id)')

  // After reconciliation the button appears; resolving must persist.
  await q
    .locator('.comment-card', { hasText: persistComment })
    .locator('.comment-resolve')
    .waitFor({ timeout: 10000 })
  await q.locator('.comment-card', { hasText: persistComment }).locator('.comment-resolve').click()
  await q.waitForFunction(
    (text) =>
      !Array.from(document.querySelectorAll('.comment-card:not(.is-resolved)')).some((card) =>
        card.textContent?.includes(text),
      ),
    persistComment,
    { timeout: 10000 },
  )
  await q.reload()
  await q.waitForSelector('.doc-status--live', { timeout: 15000 })
  await q.waitForTimeout(800) // post-reload comment list settle
  const resolvedCameBack = await q
    .locator('.comment-card:not(.is-resolved)', { hasText: persistComment })
    .count()
  if (resolvedCameBack === 0) ok('resolved comment stayed resolved across reload')
  else fail('resolved comment reappeared open after reload')

  // Inline tracked edit: accept then reload immediately — the resolve syncs
  // through Yjs and must already be on the server. (Boundary note: local
  // updates made while the cable is disconnected are only re-sent at the
  // next reconnect handshake — a refresh inside that window loses them.
  // Not simulated here; see docs/plans/2026-06-07-001 R3.)
  await q.click('.mode-control-trigger')
  await q.locator('.mode-control-option', { hasText: 'Suggest' }).click()
  await q.click('.milkdown .ProseMirror')
  await q.keyboard.press('Meta+ArrowDown')
  await q.keyboard.press('End')
  const trackedSentinel = `persist-${Date.now()}`
  await q.keyboard.type(` ${trackedSentinel}`)
  await q.locator('.milkdown ins.sug-ins', { hasText: trackedSentinel }).first().waitFor({ timeout: 5000 })
  await q.waitForTimeout(1200) // let the insertion itself persist first
  await q.locator('.margin-card--inline .btn-accept').first().click()
  await q.reload()
  await q.waitForSelector('.doc-status--live', { timeout: 15000 })
  await q.waitForTimeout(1200)
  const trackedStillMarked = await q
    .locator('.milkdown ins.sug-ins', { hasText: trackedSentinel })
    .count()
  const trackedTextKept = await q
    .locator('.milkdown .ProseMirror', { hasText: trackedSentinel })
    .count()
  if (trackedStillMarked === 0 && trackedTextKept > 0) {
    ok('inline tracked-edit accept persisted across an immediate reload')
  } else {
    fail(`inline accept did not persist: marks=${trackedStillMarked} text=${trackedTextKept}`)
  }
  await q.close()

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
