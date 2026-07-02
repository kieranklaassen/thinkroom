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
