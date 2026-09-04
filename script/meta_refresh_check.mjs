// Regression check: metadata committed before the cable connects must still
// reach the page (use_meta_channel refreshes cable-fed props on `connected`).
//
// The server renders a document page's props, then the browser boots JS and
// only later subscribes to DocumentMetaChannel. A suggestion committed inside
// that window broadcasts to nobody; before the connected-refresh fix the
// margin rail stayed stale until a manual reload (found dogfooding an agent
// chaining `thinkroom update` + `thinkroom suggest`).
//
// Deterministic setup: /cable is intercepted and held until the suggestion
// POST commits, so the broadcast is always lost and only the reconnect
// refresh can surface it. Usage:
//
//   BASE_URL=http://localhost:3000 SLUG=demo node script/meta_refresh_check.mjs
//
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { waitForLive } from './lib/check_helpers.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SLUG = process.env.SLUG ?? 'demo'

const ok = (msg) => console.log(`✓ ${msg}`)
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}

const marker = `meta-refresh-check ${Date.now()}`
let releaseCable
const cableHeld = new Promise((resolve) => (releaseCable = resolve))

const browser = await chromium.launch()
let page
let suggestionId
try {
  const context = await browser.newContext()
  page = await context.newPage()

  await page.routeWebSocket(/\/cable/, async (ws) => {
    await cableHeld
    const server = ws.connectToServer()
    ws.onMessage((message) => server.send(message))
    server.onMessage((message) => ws.send(message))
  })

  await page.goto(`${BASE}/d/${SLUG}/edit`)

  const response = await fetch(`${BASE}/api/docs/${SLUG}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Name': 'Meta Refresh Check' },
    body: JSON.stringify({ body: marker, intent: 'meta refresh regression check' }),
  })
  if (!response.ok) {
    fail(`suggestion POST failed: ${response.status} ${await response.text()}`)
    process.exit(1)
  }
  suggestionId = (await response.json()).id
  ok('suggestion committed while /cable was held (broadcast lost by design)')

  releaseCable()

  try {
    await page.waitForFunction(
      (text) => document.querySelector('.margin-suggestions')?.innerText.includes(text),
      marker,
      { timeout: 15000 },
    )
    ok('margin rail showed the suggestion after connect without a manual reload')
  } catch {
    fail('suggestion never appeared: connected-refresh of cable-fed props is broken')
  }

  // An isolated document exercises the real cable → Inertia → timeline chain.
  const activityContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const activityPage = await activityContext.newPage()
  const created = await activityContext.request.post(`${BASE}/api/docs`, {
    data: { title: 'Activity filters check', content: '# Activity\n\nA document for live review.' },
  })
  assert(created.ok())
  const activitySlug = (await created.json()).slug
  await activityPage.goto(`${BASE}/d/${activitySlug}/edit`)
  await waitForLive(activityPage)
  const feed = activityPage.locator('.doc-rail').getByRole('region', { name: 'Activity', exact: true })
  await feed.getByRole('button', { name: 'Agents', exact: true }).click({ timeout: 5000 })
  assert.match(await feed.innerText(), /Quiet so far/)

  const postComment = async (name, body) => {
    const response = await activityContext.request.post(`${BASE}/api/docs/${activitySlug}/comments`, {
      headers: { 'X-Agent-Name': name }, data: { body },
    })
    assert(response.ok(), `comment failed: ${response.status()}`)
    return (await response.json()).comment.id
  }
  const commentIds = []
  for (let i = 0; i < 7; i++) commentIds.push(await postComment(`Reviewer ${i}`, `Observation ${i}`))
  await feed.locator('.activity-row', { hasText: 'Reviewer 6' }).first().waitFor()
  assert.equal(await feed.getByRole('button', { name: 'Agents', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await feed.locator('.activity-row').count(), 6)
  await feed.getByRole('button', { name: /Show all/ }).click()
  assert(await feed.locator('.activity-row').count() > 6)
  assert.match(await feed.innerText(), /recent events/)

  // A new member of the head group keeps the actual DOM row and focus.
  // The first comment is followed by the actor's joined event, so start a
  // fresh consecutive comment group after that presence has been established.
  await postComment('Reviewer 6', 'Second observation')
  await postComment('Reviewer 6', 'Third observation')
  await feed.locator('.activity-row', { hasText: 'left 2 comments' }).waitFor()
  await feed.getByRole('button', { name: 'Agents', exact: true }).focus()
  await activityPage.evaluate(() => {
    window.__activityRow = [...document.querySelectorAll('.doc-rail .activity-row')].find(el => el.textContent.includes('left 2 comments'))
    window.__activityFocus = document.activeElement
  })
  await postComment('Reviewer 6', 'Fourth observation')
  await feed.locator('.activity-row', { hasText: 'left 3 comments' }).waitFor()
  assert(await activityPage.evaluate(() => window.__activityRow?.isConnected && window.__activityFocus === document.activeElement))
  ok('live grouping retains row identity, expansion and keyboard focus')

  await feed.getByRole('button', { name: 'Decisions', exact: true }).click()
  assert.equal(await feed.locator('.activity-row').count(), 0)
  assert.match(await feed.innerText(), /No decisions in the .*recent events/)
  const resolved = await activityContext.request.post(`${BASE}/api/docs/${activitySlug}/comments/${commentIds[0]}/resolve`, {
    headers: { 'X-Agent-Name': 'Reviewer 0' },
  })
  assert(resolved.ok())
  await feed.locator('.activity-row', { hasText: 'resolved a comment' }).waitFor()
  assert.equal(await feed.getByRole('button', { name: 'Decisions', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await feed.locator('.activity-row').count(), 1)
  assert.match(await feed.innerText(), /1 of \d+ recent events/)
  ok('Decisions remains selected and updates from real committed events')

  await feed.getByRole('button', { name: 'All', exact: true }).click()
  const humanStatus = await activityPage.evaluate(async (slug) => {
    const response = await fetch(`/d/${slug}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
      body: JSON.stringify({ slug, body: 'Human negative control', author_name: 'Human Reviewer' }),
    })
    return response.status
  }, activitySlug)
  assert.equal(humanStatus, 200)
  const humanRow = feed.locator('.activity-row--human', { hasText: 'commented' }).first()
  await humanRow.waitFor()
  const humanName = await humanRow.locator('strong').innerText()
  await postComment(humanName, 'Agent namesake')
  await feed.locator('.activity-row--agent', { hasText: humanName }).first().waitFor()
  assert.equal(await humanRow.count(), 1, 'human and agent namesakes retain separate rows')
  await feed.getByRole('button', { name: 'Agents', exact: true }).click()
  assert.equal(await feed.locator('.activity-row--human').count(), 0)
  assert(await feed.locator('.activity-row--agent', { hasText: humanName }).count() > 0)
  ok('Agents excludes human activity without conflating namesakes')

  await feed.getByRole('button', { name: 'Agents', exact: true }).click()
  assert(await feed.locator('.activity-row').count() > 6, 'filter changes preserve expansion')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await activityPage.keyboard.press(`${mod}+Backslash`)
  await activityPage.reload()
  await waitForLive(activityPage)
  assert(await activityPage.locator('.doc-page').evaluate(el => el.classList.contains('is-panel-hidden')))
  await activityPage.keyboard.press(`${mod}+Backslash`)
  assert.equal(await feed.getByRole('button', { name: 'Agents', exact: true }).getAttribute('aria-pressed'), 'true')
  assert(await feed.locator('.activity-row').count() > 6, 'expansion survives refresh with panel hidden')
  assert.equal(await feed.locator('.activity-expander').getAttribute('aria-expanded'), 'true')
  assert.equal(await activityPage.locator('.doc-rail').evaluate(el => getComputedStyle(el).overflowY), 'visible')
  ok('hidden panel, filter and expansion survive refresh without an inner rail scrollbar')

  await activityPage.setViewportSize({ width: 390, height: 844 })
  const openActivity = () => activityPage.getByRole('navigation', { name: 'Document tools' }).getByRole('button', { name: 'Activity', exact: true }).click()
  await openActivity()
  const sheet = activityPage.getByRole('dialog', { name: 'Activity', exact: true })
  assert.equal(await sheet.getByRole('button', { name: 'Agents', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await sheet.locator('.activity-expander').getAttribute('aria-expanded'), 'true')
  assert.equal(await activityPage.locator('body').evaluate(el => el.style.overflow), 'hidden')
  await sheet.getByRole('button', { name: 'Show fewer', exact: true }).click()
  await sheet.getByRole('button', { name: 'Decisions', exact: true }).click()
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await activityPage.reload()
  await waitForLive(activityPage)
  await openActivity()
  assert.equal(await sheet.getByRole('button', { name: 'Decisions', exact: true }).getAttribute('aria-pressed'), 'true')
  await sheet.getByRole('button', { name: 'Agents', exact: true }).click()
  assert.equal(await sheet.locator('.activity-row').count(), 6)
  assert.equal(await sheet.locator('.activity-expander').getAttribute('aria-expanded'), 'false')
  const buttonHeights = await sheet.locator('.activity-filters button').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height))
  assert.equal(buttonHeights.length, 3, 'compact sheet renders all three filters')
  assert(buttonHeights.every(height => height >= 44), 'compact filter targets remain touch-sized')
  ok('mobile sheet shares preferences, persists changes and locks the underlying page')
  await activityPage.evaluate(() => {
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => { throw new Error('Storage blocked') } })
  })
  await sheet.getByRole('button', { name: 'All', exact: true }).click()
  await sheet.getByRole('button', { name: /Show all/ }).click()
  assert.equal(await sheet.getByRole('button', { name: 'All', exact: true }).getAttribute('aria-pressed'), 'true')
  assert(await sheet.locator('.activity-row').count() > 6)
  ok('rejected cookie writes leave activity controls usable in memory')
  await activityContext.close()
} finally {
  // Leave the shared demo doc as found: a lingering pending suggestion
  // becomes the FIRST margin card for later checks in the CI loop
  // (browser_check accepts `.margin-card .btn-accept` on this doc). The
  // reject endpoint is CSRF-protected, so run it from the page's session.
  if (suggestionId) {
    await page.evaluate(async (id) => {
      const token = document.querySelector('meta[name="csrf-token"]')?.content ?? ''
      await fetch(`/suggestions/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ by: 'Meta Refresh Check' }),
      })
    }, suggestionId).catch(() => {})
  }
  await browser.close()
}
