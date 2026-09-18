// Compound writing mode smoke check using Playwright, against a server started
// with COMPOUND_WRITING_FAKE_JUDGE=1 (the deterministic lexicon judge).
// Usage: BASE_URL=http://localhost:3000 node script/compound_writing_check.mjs
import { chromium } from 'playwright'
import { expectedBrowserNoise, waitForLive } from './lib/check_helpers.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

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

const openPage = async (path, viewport = { width: 1600, height: 1000 }) => {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !expectedBrowserNoise(message.text())) pageErrors.push(message.text())
  })
  page.setDefaultTimeout(15000)
  await page.goto(`${BASE}${path}`)
  return page
}

const reviewerRow = (page, name) =>
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

  // AE1: Cmd+5 from Edit lands on /compound with the reviewers panel.
  const page = await openPage(`/d/${slug}/edit`)
  await waitForLive(page)
  // Focus the copy first: the shortcut ignores form controls. A keypress that
  // lands while the just-mounted editor is still settling its selection is
  // retried once, as a person would.
  const switchMode = async (digit, path) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('.doc-live-editor p').first().click()
      await page.keyboard.press(`Meta+${digit}`)
      try {
        await page.waitForFunction((expected) => location.pathname === expected, path, { timeout: attempt === 0 ? 5000 : 15000 })
        return
      } catch {
        if (attempt === 1) {
          throw new Error(`Cmd+${digit} did not reach ${path}; still at ${await page.evaluate(() => location.pathname)} with focus on ${await page.evaluate(() => document.activeElement?.tagName)}`)
        }
      }
    }
  }
  await switchMode(5, `/d/${slug}/compound`)
  check(await page.locator('.mode-control-trigger').innerText() === 'Compound mode ▾' || (await page.locator('.mode-control-trigger').innerText()).includes('Compound'), 'Cmd+5 switches to Compound mode')
  await page.locator('.compound-panel').waitFor()
  check((await page.locator('.compound-reviewer').count()) >= 13, 'the panel lists every reviewer')
  check(await page.locator('.compound-run').isEnabled(), 'Run all is enabled with the fake judge configured')

  // R6: switching a reviewer off persists through reload via the cookie.
  await reviewerRow(page, 'Nemesis').locator('input[role="switch"]').click()
  await page.reload()
  await waitForLive(page)
  check(await reviewerRow(page, 'Nemesis').locator('input[role="switch"]').isChecked() === false, 'a reviewer switched off stays off after reload')
  check(await reviewerRow(page, 'Hemingway').locator('input[role="switch"]').isChecked(), 'other reviewers stay on')

  // The run request carries the projected paragraphs (code block excluded) and only the reviewers that are on.
  const [request] = await Promise.all([
    page.waitForRequest((candidate) => candidate.method() === 'POST' && candidate.url().includes('/writing_passes')),
    page.locator('.compound-run').click(),
  ])
  const payload = request.postDataJSON()
  check(!payload.reviewers.includes('nemesis') && payload.reviewers.includes('ai_check'), 'the run posts only the reviewers that are on')
  check(payload.paragraphs.every((paragraph) => !paragraph.text.includes('inside code')), 'code blocks are not sent for review')
  check(payload.paragraphs.some((paragraph) => paragraph.text === 'We utilize this line before the break\nand the sentence continues after it.'), 'a hard break projects as a newline inside the paragraph')
  check(payload.paragraphs[0].kind === 'heading' && payload.paragraphs[1].text.startsWith('We should utilize'), 'paragraphs carry their kind and text in document order')

  // AE2: findings stream in as highlights and a margin card.
  await page.waitForFunction(() => CSS.highlights?.has('cw-ai_check-fill'), undefined, { timeout: 20000 })
    .catch(() => { throw new Error('no cw-ai_check-fill highlight arrived within 20s of the run') })
  ok('AI check paints a fill highlight for its phrase findings')
  const utilizeCard = page.locator('.compound-card').filter({ hasText: 'utilize' })
  await utilizeCard.first().waitFor()
  const cardText = (await utilizeCard.first().innerText()).toLowerCase()
  check(cardText.includes('ai check') && cardText.includes('leverage'), 'the paragraph\'s margin card groups the AI check findings on "utilize" and "leverage"')
  check((await page.locator('.compound-card').count()) === (await page.locator('.compound-card').evaluateAll((cards) => new Set(cards.map((card) => card.style.top)).size)), 'margin cards stack without overlapping tops')
  await page.screenshot({ path: process.env.SCREENSHOT ?? '/tmp/compound_writing_check.png', fullPage: false })
  await page.locator('.compound-status').filter({ hasText: /Finished/ }).waitFor({ timeout: 20000 })
  ok('the pass finishes and the panel says so')
  const aiCount = Number(await reviewerRow(page, 'AI check').locator('.compound-count').innerText())
  check(aiCount >= 4, `AI check reports its findings (${aiCount})`)
  check((await reviewerRow(page, 'Nemesis').locator('.compound-count').count()) === 0, 'a reviewer that is off has no count')

  // R9: the sentence question underlines while the phrase question fills.
  const names = await highlightNames(page)
  check(names.includes('cw-ai_check-fill') && names.includes('cw-ai_check-under'), 'phrase fills and sentence underlines are both registered')

  // A sentence quote that spans a hard break still anchors (its stored text
  // carries the projection's "\n") and paints an underline across both lines.
  const acrossBreak = await page.evaluate(() => {
    const texts = []
    for (const range of CSS.highlights.get('cw-ai_check-under') ?? []) texts.push(range.toString())
    return texts.find((text) => text.includes('before the break') && text.includes('continues after it')) ?? null
  })
  check(acrossBreak !== null, 'a sentence finding across a hard break anchors and underlines both lines')
  check((await page.locator('.compound-card').filter({ hasText: 'before the break' }).count()) === 1, 'the hard-break paragraph gets its margin card')
  check(!(await page.locator('.compound-status').innerText()).includes('changed'), 'unchanged text with a hard break reports no changed findings')

  // R11: AI check and Line edit both flag "robust"; one keeps the fill and
  // the other is demoted to its underline, so no two fills overlap.
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
  const overlapping = await page.evaluate(() => {
    const ranges = []
    for (const [name, highlight] of CSS.highlights) {
      if (!name.endsWith('-fill')) continue
      for (const range of highlight) ranges.push(range)
    }
    return ranges.some((a, i) => ranges.some((b, j) => i !== j &&
      a.compareBoundaryPoints(Range.END_TO_START, b) < 0 && a.compareBoundaryPoints(Range.START_TO_END, b) > 0))
  })
  check(!overlapping, 'phrase fills never overlap')

  // Read mode clears every cw-* highlight; coming back restores them.
  await switchMode(4, `/d/${slug}`)
  await page.waitForFunction(() => ![...CSS.highlights.keys()].some((name) => name.startsWith('cw-'))).catch(() => { throw new Error('Read mode left cw-* highlights registered') })
  ok('Read mode clears the compound highlights')
  await switchMode(5, `/d/${slug}/compound`)
  await page.waitForFunction(() => CSS.highlights?.has('cw-ai_check-fill')).catch(() => { throw new Error('Compound mode did not restore the highlights') })
  ok('returning to Compound mode restores them')

  // Dismiss reaches a second window through the broadcast.
  const other = await openPage(`/d/${slug}/compound`)
  await waitForLive(other)
  await other.locator('.compound-card').first().waitFor()
  const totalCount = () => other.locator('.compound-count').evaluateAll((els) => els.reduce((sum, el) => sum + Number(el.textContent), 0))
  const before = await totalCount()
  await page.locator('.compound-card-row').first().locator('.compound-finding-dismiss').click()
  await other.waitForFunction((count) => [...document.querySelectorAll('.compound-count')].reduce((sum, el) => sum + Number(el.textContent), 0) < count, before)
    .catch(() => { throw new Error('the second window never saw the dismissed finding disappear') })
  ok('dismissing a finding removes it in another window')

  // AE3: editing the flagged word marks the finding changed; editing elsewhere in the paragraph keeps the rest.
  const paragraph = page.locator('.doc-live-editor p').filter({ hasText: 'utilize the robust report' }).first()
  const leverageCountBefore = await page.evaluate(() => {
    let count = 0
    for (const range of CSS.highlights.get('cw-ai_check-fill') ?? []) if (range.toString() === 'leverage') count++
    return count
  })
  check(leverageCountBefore === 1, 'the "leverage" fill is present before the edit')
  const utilizeFills = () => page.evaluate(() => {
    let count = 0
    for (const range of CSS.highlights.get('cw-ai_check-fill') ?? []) if (range.toString() === 'utilize') count++
    return count
  })
  const utilizeBefore = await utilizeFills()
  check(utilizeBefore === 2, `"utilize" is filled in both paragraphs before the edit (${utilizeBefore})`)
  await paragraph.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const index = node.textContent.indexOf('utilize')
      if (index < 0) continue
      element.closest('.ProseMirror').focus()
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 'utilize'.length)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error('utilize not found in the paragraph')
  })
  await page.waitForTimeout(100)
  await page.keyboard.type('use')
  await page.waitForFunction((before) => {
    let count = 0
    for (const range of CSS.highlights.get('cw-ai_check-fill') ?? []) if (range.toString() === 'utilize') count++
    return count === before - 1
  }, utilizeBefore).catch(() => { throw new Error('editing the flagged word did not remove its highlight') })
  ok('editing the flagged word removes its highlight and leaves the other paragraph\'s')
  await page.waitForFunction(() => {
    for (const range of CSS.highlights.get('cw-ai_check-fill') ?? []) if (range.toString() === 'leverage') return true
    return false
  }).catch(() => { throw new Error('the "leverage" fill in the edited paragraph was lost') })
  ok('the other findings in the same paragraph keep their highlights')
  await page.locator('.compound-status').filter({ hasText: /changed since the last run/ }).waitFor()
  ok('the panel counts the changed finding')
  await reviewerRow(page, 'AI check').locator('.compound-reviewer-main').click()
  await page.locator('.compound-finding.is-changed').first().waitFor()
  check(await page.locator('.compound-finding.is-changed .compound-finding-main').first().isDisabled(), 'a changed finding cannot jump')

  // Compact layout: markers in the gutter and the reviewers sheet from the dock.
  const phone = await openPage(`/d/${slug}/compound`, { width: 420, height: 860 })
  await waitForLive(phone)
  await phone.locator('.margin-marker--finding').first().waitFor()
  await phone.locator('.dock-item', { hasText: 'Reviewers' }).click()
  await phone.locator('.sheet .compound-panel, .mobile-sheet .compound-panel, .compound-panel').first().waitFor()
  ok('compact layouts show markers and open the reviewers sheet from the dock')
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  if (pageErrors.length) fail(`page errors: ${pageErrors.join(' | ')}`)
  await browser.close()
}
