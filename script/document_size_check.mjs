// Yjs write-discipline and size-guard regression check using Playwright.
//
// Guards the two invariants behind the oversized-document incident (a 4 MB
// paste left a 10 MB Yjs state behind a 72-byte saved source):
// - Opening a live document without editing writes nothing: the only Yjs
//   frames the page sends after its handshake are the empty sync-reply and
//   awareness, and the stored state served to the next visitor is identical.
// - A local edit that would push the document past its size limit is refused
//   before it reaches Yjs, with a visible notice, while an ordinary edit
//   still lands.
// Usage: BASE_URL=http://localhost:3000 node script/document_size_check.mjs
import { chromium, request } from 'playwright'
import { expectedBrowserNoise, waitForLive } from './lib/check_helpers.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
// Mirrors MAX_DOCUMENT_SIZE in app/frontend/editor/document_size_guard.ts.
const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024
// Base64 of the empty v1 update ([0, 0]) — the sync-reply of a client that
// has nothing the server lacks.
const EMPTY_UPDATE = 'AAA='
const failures = []
const startedAt = Date.now()
const watchdog = setTimeout(() => {
  console.error('✗ document size check exceeded its time budget')
  process.exit(1)
}, 180000)
const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
const check = (condition, message, detail = '') => {
  if (condition) {
    console.log(`✓ ${message} (${elapsed()})`)
  } else {
    failures.push(message)
    console.error(`✗ ${message}${detail ? `: ${detail}` : ''} (${elapsed()})`)
  }
}

const content = [
  '# Size check',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. ${'Steady prose that nobody edits. '.repeat(4)}`),
  '',
  'Last paragraph, so the trailing-node plugin has nothing to append.',
  '',
].join('\n')

const api = await request.newContext({
  baseURL: BASE,
  extraHTTPHeaders: { 'X-Agent-Name': 'Document size check' },
})
const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Accept: 'text/html',
}
const browser = await chromium.launch()
const errors = []
const watch = (page, label) => {
  page.on('pageerror', (error) => {
    const message = error.stack ?? String(error)
    if (!expectedBrowserNoise(message)) errors.push(`${label}: ${message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && !expectedBrowserNoise(message.text())) {
      errors.push(`${label}: ${message.text()}`)
    }
  })
}

// Yjs frames this page sends on its SyncChannel subscription, decoded from
// the Action Cable envelope. Awareness frames are relay-only and excluded.
const recordYjsFrames = (page) => {
  const frames = []
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => {
      let envelope
      try {
        envelope = JSON.parse(String(payload))
      } catch {
        return
      }
      if (envelope.command !== 'message' || !String(envelope.identifier).includes('SyncChannel')) return
      const data = JSON.parse(envelope.data)
      if (data.type === 'update' || data.type === 'sync-reply') frames.push(data)
    })
  })
  return frames
}

// The Yjs state embedded in the page HTML for the next visitor.
const storedState = async (slug) => {
  const response = await api.get(`/d/${slug}`, { headers: browserHeaders })
  const html = await response.text()
  // The prop sits in the Inertia page JSON, which the render path emits
  // either raw (SSR script) or attribute-escaped (&quot;).
  const match = html.match(/yjs_state_b64(?:"|&quot;):(?:"|&quot;)([A-Za-z0-9+/=]*)/)
  return match ? match[1] : null
}

let slug

try {
  const created = await api.post('/api/docs', {
    data: { title: 'Document size check', format: 'markdown', content },
  })
  check(created.status() === 201, 'created the fixture document', `status ${created.status()}`)
  slug = (await created.json()).slug

  // First open seeds the document from its template and persists the state.
  const seeder = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const seedPage = await seeder.newPage()
  watch(seedPage, 'seeder')
  await seedPage.goto(`${BASE}/d/${slug}/edit`, { waitUntil: 'domcontentloaded' })
  await waitForLive(seedPage, 60000)
  await seedPage.waitForTimeout(1500)
  await seeder.close()

  const stateBefore = await storedState(slug)
  check(Boolean(stateBefore), 'the seeded document has stored Yjs state embedded in its page')

  // Second open: read only. Nothing with content may go out, and the state
  // the next visitor gets must be byte-identical.
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const visitorPage = await visitor.newPage()
  watch(visitorPage, 'visitor')
  const visitorFrames = recordYjsFrames(visitorPage)
  await visitorPage.goto(`${BASE}/d/${slug}/edit`, { waitUntil: 'domcontentloaded' })
  await waitForLive(visitorPage, 60000)
  await visitorPage.waitForTimeout(3000)
  // Not even the empty sync-reply: a client that only hydrated owes the
  // server nothing, and Y.encodeStateAsUpdate would otherwise echo the
  // document's whole delete set on every open.
  check(
    visitorFrames.length === 0,
    'opening a live document without editing sends no Yjs update or sync-reply frame',
    JSON.stringify(visitorFrames.map((frame) => ({ type: frame.type, bytes: frame.update.length }))),
  )
  await visitor.close()

  const stateAfter = await storedState(slug)
  check(stateAfter === stateBefore, 'the stored Yjs state is unchanged after a read-only open')

  // Third open: the size guard. A paste that would push the document past
  // the limit is refused with a notice; a small paste still lands.
  const editor = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const editorPage = await editor.newPage()
  watch(editorPage, 'editor')
  const editorFrames = recordYjsFrames(editorPage)
  await editorPage.goto(`${BASE}/d/${slug}/edit`, { waitUntil: 'domcontentloaded' })
  await waitForLive(editorPage, 60000)
  await editorPage.waitForTimeout(1000)
  const framesBeforePaste = editorFrames.filter((frame) => frame.update !== EMPTY_UPDATE).length

  const paste = (text) =>
    editorPage.evaluate((payload) => {
      const prose = document.querySelector('.doc-live-editor .ProseMirror')
      const target = prose.querySelector('p:last-of-type')
      const range = document.createRange()
      range.selectNodeContents(target)
      range.collapse(false)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      prose.focus()
      const data = new DataTransfer()
      data.setData('text/plain', payload)
      prose.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, text)
  const textLength = () =>
    editorPage.evaluate(() => document.querySelector('.doc-live-editor .ProseMirror').textContent.length)

  const lengthBefore = await textLength()
  await paste('z'.repeat(MAX_DOCUMENT_SIZE + 1024))
  const noticeShown = await editorPage
    .waitForSelector('.doc-notice', { timeout: 15000 })
    .then((node) => node.textContent())
    .catch(() => null)
  check(
    noticeShown?.includes('2 MB limit') ?? false,
    'an oversized paste shows the refused-edit notice',
    String(noticeShown),
  )
  const lengthAfterRefused = await textLength()
  check(lengthAfterRefused === lengthBefore, 'the refused paste leaves the document unchanged', `${lengthBefore} -> ${lengthAfterRefused}`)
  await editorPage.waitForTimeout(1500)
  check(
    editorFrames.filter((frame) => frame.update !== EMPTY_UPDATE).length === framesBeforePaste,
    'the refused paste never reaches Yjs',
  )

  await paste(' Accepted.')
  const accepted = await editorPage
    .waitForFunction(
      () => document.querySelector('.doc-live-editor .ProseMirror').textContent.includes('Accepted.'),
      undefined,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false)
  check(accepted, 'an ordinary paste still lands after a refused one')
  await editorPage.waitForTimeout(1500)
  check(
    editorFrames.filter((frame) => frame.update !== EMPTY_UPDATE).length > framesBeforePaste,
    'the accepted paste is sent to the server',
  )
  await editor.close()
} catch (error) {
  failures.push(String(error))
  console.error(`✗ ${error.stack ?? error}`)
} finally {
  if (errors.length > 0) {
    failures.push('browser errors')
    console.error('✗ browser errors:\n' + errors.map((e) => `  ${e}`).join('\n'))
  }
  await browser.close()
  await api.dispose()
}

clearTimeout(watchdog)
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\ndocument size check passed')
