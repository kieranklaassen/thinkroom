// Compound writing smoke check using Playwright, against a server started
// with COMPOUND_WRITING_FAKE_JUDGE=1 (the deterministic lexicon judge) and a
// featured account prepared by `bin/rails "compound_writing:check_account[...]"`.
// Usage: BASE_URL=http://localhost:3000 CHECK_EMAIL=... CHECK_PASSWORD=... node script/compound_writing_check.mjs
import { chromium } from 'playwright'
import { expectedBrowserNoise, waitForLive } from './lib/check_helpers.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.CHECK_EMAIL ?? 'compound-check@example.com'
const PASSWORD = process.env.CHECK_PASSWORD ?? 'thoughtful-passphrase'

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}
const ok = (msg) => console.log(`✓ ${msg}`)
const check = (condition, message) => {
  if (!condition) throw new Error(message)
  ok(message)
}

const browser = await chromium.launch()
const pageErrors = []

const openContext = async (viewport = { width: 1600, height: 1000 }) => {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !expectedBrowserNoise(message.text())) pageErrors.push(message.text())
  })
  page.setDefaultTimeout(15000)
  return page
}

const signIn = async (page) => {
  await page.goto(`${BASE}/login`)
  await page.locator('input[name="email"]').fill(EMAIL)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.locator('#auth-submit').click()
  await page.waitForFunction(() => location.pathname !== '/login')
}

const lensRow = (page, name) =>
  page.locator('.compound-reviewer').filter({ has: page.locator('.compound-reviewer-name', { hasText: new RegExp(`^${name}$`) }) })

const highlightNames = (page) => page.evaluate(() => (CSS.highlights ? [...CSS.highlights.keys()] : []))

try {
  const response = await fetch(`${BASE}/api/docs`, {
    method: 'POST',
    headers: { 'X-Agent-Name': 'Compound check', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Compound writing check',
      content: [
        '# Compound writing check',
        'We should utilize the robust report to leverage synergies across the whole team this quarter, obviously.',
        'Plain words carry the second paragraph without any trouble at all for anyone.',
        // Two trailing spaces: a hard break inside one sentence, so the
        // sentence quote spans an inline leaf (projected as "\n").
        'We utilize this line before the break  \nand the sentence continues after it.',
        '```\nutilize inside code stays unreviewed\n```',
      ].join('\n\n'),
    }),
  })
  if (!response.ok) throw new Error(`document fixture API failed: ${response.status}`)
  const { slug } = await response.json()

  // AE1 (gate): a signed-out visitor in Comment mode sees no reviewers.
  const visitor = await openContext()
  await visitor.goto(`${BASE}/d/${slug}/comment`)
  await waitForLive(visitor)
  await visitor.locator('.doc-rail').waitFor()
  check((await visitor.locator('.compound-panel').count()) === 0, 'a signed-out visitor gets no reviewers panel in Comment mode')
  check(!(await highlightNames(visitor)).some((name) => name.startsWith('cw-')), 'a signed-out visitor gets no finding highlights')
  const gone = await visitor.request.get(`${BASE}/d/${slug}/compound`)
  check(gone.status() === 404, 'the old /compound route is gone')
  await visitor.context().close()

  // A featured account signs in; Comment mode hosts the reviewers.
  const page = await openContext()
  await signIn(page)
  await page.goto(`${BASE}/d/${slug}/edit`)
  await waitForLive(page)
  const switchMode = async (digit, path) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('.doc-live-editor p').first().click()
      await page.keyboard.press(`Meta+${digit}`)
      try {
        await page.waitForFunction((expected) => location.pathname === expected, path, { timeout: attempt === 0 ? 5000 : 15000 })
        return
      } catch {
        if (attempt === 1) throw new Error(`Cmd+${digit} did not reach ${path}; still at ${await page.evaluate(() => location.pathname)}`)
      }
    }
  }
  check((await page.locator('.compound-panel').count()) === 0, 'Edit mode shows no reviewers panel')
  await switchMode(3, `/d/${slug}/comment`)
  await page.locator('.compound-panel').waitFor()
  ok('Comment mode shows the reviewers panel for a featured account')
  await page.keyboard.press('Meta+5')
  await page.waitForTimeout(300)
  check((await page.evaluate(() => location.pathname)) === `/d/${slug}/comment`, 'Cmd+5 no longer switches mode')
  check((await page.locator('.compound-pack').count()) === 1, 'the account has one pack')
  check((await page.locator('.compound-pack-meta').first().innerText()).includes('EveryInc/compound-writing'), 'the pack names its marketplace and commit')
  check((await page.locator('.compound-reviewer').count()) === 13, 'the pack lists thirteen lenses')
  check(await page.locator('.compound-run').isEnabled(), 'Run all is enabled with the fake judge configured')

  // R8: switching a lens off persists on the account (visible after reload).
  // The account keeps its state between runs, so start from "on".
  const setSwitch = async (name, wanted) => {
    const input = lensRow(page, name).locator('input[role="switch"]')
    if ((await input.isChecked()) === wanted) return
    await input.click()
    await page.waitForFunction(() => document.querySelector('.compound-switch input:disabled') === null)
    await page.waitForFunction(([label, on]) => document.querySelector(`input[aria-label="${label} reviewer"]`)?.checked === on, [`${name}`, wanted])
  }
  await setSwitch('Nemesis', true)
  await setSwitch('Nemesis', false)
  await page.reload()
  await waitForLive(page)
  check(await lensRow(page, 'Nemesis').locator('input[role="switch"]').isChecked() === false, 'a lens switched off stays off after reload')
  check(await lensRow(page, 'Hemingway').locator('input[role="switch"]').isChecked(), 'other lenses stay on')

  // The run posts the projected paragraphs (code block excluded) and only the lenses that are on.
  const [request] = await Promise.all([
    page.waitForRequest((candidate) => candidate.method() === 'POST' && candidate.url().includes('/writing_passes')),
    page.locator('.compound-run').click(),
  ])
  const payload = request.postDataJSON()
  check(!payload.reviewers.includes('compound-writing/cw-nemesis') && payload.reviewers.includes('compound-writing/cw-ai-check'), 'the run posts only the lenses that are on')
  check(payload.paragraphs.every((paragraph) => !paragraph.text.includes('inside code')), 'code blocks are not sent for review')
  check(payload.paragraphs.some((paragraph) => paragraph.text === 'We utilize this line before the break\nand the sentence continues after it.'), 'a hard break projects as a newline inside the paragraph')

  // AE2: findings stream in as highlights and margin cards, beside comments.
  await page.waitForFunction(() => [...CSS.highlights.keys()].some((name) => /^cw-\d+-fill$/.test(name)), undefined, { timeout: 20000 })
    .catch(() => { throw new Error('no cw-<slot>-fill highlight arrived within 20s of the run') })
  ok('lenses paint fill highlights for their phrase findings')
  const utilizeCard = page.locator('.compound-card').filter({ hasText: 'utilize' })
  await utilizeCard.first().waitFor()
  const cardText = (await utilizeCard.first().innerText()).toLowerCase()
  check(cardText.includes('ai check') && cardText.includes('leverage'), 'the paragraph\'s margin card groups the AI check findings on "utilize" and "leverage"')
  await page.locator('.compound-status').filter({ hasText: /Finished/ }).waitFor({ timeout: 20000 })
  ok('the pass finishes and the panel says so')
  const aiCount = Number(await lensRow(page, 'AI check').locator('.compound-count').innerText())
  check(aiCount >= 4, `AI check reports its findings (${aiCount})`)
  check((await lensRow(page, 'Nemesis').locator('.compound-count').count()) === 0, 'a lens that is off has no count')

  // R5: a comment on the same paragraph shares the margin stack without overlap.
  const commentResponse = await fetch(`${BASE}/api/docs/${slug}/comments`, {
    method: 'POST', headers: { 'X-Agent-Name': 'Compound check', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'A comment beside the findings.', anchor_text: 'Plain words carry the second paragraph' }),
  })
  if (!commentResponse.ok) throw new Error(`comment API failed: ${commentResponse.status}`)
  await page.locator('.margin-comment').first().waitFor({ timeout: 15000 })
  // The stack re-measures after the comment card mounts; wait for a settled,
  // non-overlapping layout rather than sampling one frame.
  const stacked = await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('.margin-gutter .margin-annotations > *')]
    if (cards.length < 2 || cards.some((el) => !el.classList.contains('is-placed'))) return false
    const boxes = cards.map((el) => el.getBoundingClientRect()).filter((box) => box.height > 0)
    return !boxes.some((a, i) => boxes.some((b, j) => i !== j && a.top < b.bottom - 1 && b.top < a.bottom - 1))
  }, undefined, { timeout: 10000 }).then(() => true).catch(() => false)
  check(stacked, 'finding cards and comment cards share the margin stack without overlapping')

  // R9 and overlap demotion, as in round one.
  const names = await highlightNames(page)
  check(names.some((name) => /^cw-\d+-fill$/.test(name)) && names.some((name) => /^cw-\d+-under$/.test(name)), 'phrase fills and sentence underlines are both registered')
  const robust = await page.evaluate(() => {
    const painted = { fill: [], under: [] }
    for (const [name, highlight] of CSS.highlights) {
      for (const range of highlight) {
        if (range.toString() !== 'robust') continue
        if (name.endsWith('-fill')) painted.fill.push(name)
        if (name.endsWith('-under')) painted.under.push(name)
      }
    }
    return painted
  })
  check(robust.fill.length === 1 && robust.under.length === 1 && robust.fill[0] !== robust.under[0], `an overlapped phrase keeps one fill (${robust.fill}) and demotes the other to an underline (${robust.under})`)
  const acrossBreak = await page.evaluate(() => {
    for (const [name, highlight] of CSS.highlights) {
      if (!name.endsWith('-under')) continue
      for (const range of highlight) {
        const text = range.toString()
        if (text.includes('before the break') && text.includes('continues after it')) return text
      }
    }
    return null
  })
  check(acrossBreak !== null, 'a sentence finding across a hard break anchors and underlines both lines')

  // Leaving Comment mode clears every cw-* highlight; coming back restores them.
  await switchMode(1, `/d/${slug}/edit`)
  await page.waitForFunction(() => ![...CSS.highlights.keys()].some((name) => name.startsWith('cw-'))).catch(() => { throw new Error('Edit mode left cw-* highlights registered') })
  check((await page.locator('.compound-panel').count()) === 0, 'Edit mode hides the panel and clears the highlights')
  await switchMode(3, `/d/${slug}/comment`)
  await page.waitForFunction(() => [...CSS.highlights.keys()].some((name) => /^cw-\d+-fill$/.test(name))).catch(() => { throw new Error('Comment mode did not restore the highlights') })
  ok('returning to Comment mode restores them')

  // Dismiss reaches a second window through the broadcast.
  const other = await openContext()
  await signIn(other)
  await other.goto(`${BASE}/d/${slug}/comment`)
  await waitForLive(other)
  await other.locator('.compound-card').first().waitFor()
  const totalCount = () => other.locator('.compound-count').evaluateAll((els) => els.reduce((sum, el) => sum + Number(el.textContent), 0))
  const before = await totalCount()
  await page.locator('.compound-card-row').first().locator('.compound-finding-dismiss').click()
  await other.waitForFunction((count) => [...document.querySelectorAll('.compound-count')].reduce((sum, el) => sum + Number(el.textContent), 0) < count, before)
    .catch(() => { throw new Error('the second window never saw the dismissed finding disappear') })
  ok('dismissing a finding removes it in another window')
  await other.context().close()

  // Compact layout: markers in the gutter and the reviewers sheet from the dock.
  const phone = await openContext({ width: 420, height: 860 })
  await signIn(phone)
  await phone.goto(`${BASE}/d/${slug}/comment`)
  await waitForLive(phone)
  await phone.locator('.margin-marker--finding').first().waitFor()
  await phone.locator('.dock-item', { hasText: 'Reviewers' }).click()
  await phone.locator('.compound-panel').first().waitFor()
  ok('compact layouts show markers and open the reviewers sheet from the dock')
  await phone.context().close()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  if (pageErrors.length) fail(`page errors: ${pageErrors.join(' | ')}`)
  await browser.close()
}
