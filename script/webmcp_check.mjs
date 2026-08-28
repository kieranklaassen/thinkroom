// WebMCP browser-tool regression check using Playwright.
// Usage: BASE_URL=http://localhost:3000 node script/webmcp_check.mjs
//
// CI's Chromium does not run the WebMCP origin trial, so this check installs a
// spec-shaped `document.modelContext` stub before each page script runs. The
// stub records registrations, honors the AbortSignal (unregister), rejects
// duplicate names like Chrome does, and exposes `__webmcpInvoke` so the check
// can call a registered tool's `execute` exactly as a browser agent would.
// Interpreter refusal scenarios go through the development seam
// `window.__thinkroomWebmcp.execute` with hand-built manifest entries.
import { chromium } from 'playwright'
import { expectedBrowserNoise, waitForLive } from './lib/check_helpers.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const ORIGIN = new URL(BASE).origin
const AGENT = 'Scout'
const DOCUMENT_TOOLS = [
  'thinkroom_guide',
  'thinkroom_read_document',
  'thinkroom_propose_suggestion',
  'thinkroom_comment',
  'thinkroom_resolve_comment',
  'thinkroom_announce_presence',
  'thinkroom_poll_events',
  'thinkroom_ack_events',
  'thinkroom_create_document',
  'thinkroom_update_document',
].sort()
const INDEX_TOOLS = ['thinkroom_guide', 'thinkroom_create_document'].sort()

const assert = (condition, message, detail = '') => {
  if (!condition) throw new Error(`${message}${detail ? `: ${detail}` : ''}`)
  console.log(`✓ ${message}`)
}
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
const parseResult = (result) => {
  assert(result && Array.isArray(result.content) && result.content[0]?.type === 'text', 'result is an MCP text envelope')
  try {
    return { text: result.content[0].text, json: JSON.parse(result.content[0].text), isError: result.isError === true }
  } catch {
    return { text: result.content[0].text, json: null, isError: result.isError === true }
  }
}

// Spec-shaped stub: https://webmachinelearning.github.io/webmcp/ (registerTool
// with AbortSignal unregistration, InvalidStateError on duplicate names,
// `toolchange` on register/unregister, getTools()).
const MODEL_CONTEXT_STUB = `
(() => {
  const tools = new Map()
  class ModelContextStub extends EventTarget {
    registerTool(tool, options = {}) {
      const signal = options.signal
      if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
      if (tools.has(tool.name)) return Promise.reject(new DOMException('duplicate tool name: ' + tool.name, 'InvalidStateError'))
      tools.set(tool.name, tool)
      window.__webmcpToolchange = (window.__webmcpToolchange ?? 0) + 1
      this.dispatchEvent(new Event('toolchange'))
      signal?.addEventListener('abort', () => {
        tools.delete(tool.name)
        window.__webmcpToolchange = (window.__webmcpToolchange ?? 0) + 1
        this.dispatchEvent(new Event('toolchange'))
      })
      return Promise.resolve()
    }
    getTools() {
      return Promise.resolve([...tools.values()].map((tool) => ({
        name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
        annotations: tool.annotations, origin: location.origin,
      })))
    }
  }
  Object.defineProperty(document, 'modelContext', { value: new ModelContextStub(), configurable: true })
  window.__webmcpInvoke = (name, args, { cancel = false } = {}) => {
    const tool = tools.get(name)
    if (!tool) throw new Error('no registered tool named ' + name)
    // The spec passes a per-execution signal; the cancel option aborts it right after
    // the call starts, the way an agent's stop button would.
    const controller = new AbortController()
    const result = tool.execute(args ?? {}, { signal: controller.signal })
    if (cancel) controller.abort()
    return result
  }
})()
`

const browser = await chromium.launch()
const errors = []
let phase = 'boot'
const isNoise = (message) =>
  expectedBrowserNoise(message, [
    // Tool calls that are supposed to fail log their HTTP status as a console error.
    'status of 404',
    'status of 409',
    'status of 422',
    'status of 423',
    'status of 503',
    // The "unreachable" scenario aborts a same-origin request with page.route.
    'net::ERR_FAILED',
    'Failed to load resource',
  ])
const watch = (page, label) => {
  page.on('pageerror', (error) => {
    const message = error.stack ?? String(error)
    if (!isNoise(message)) errors.push(`${label} [${phase}]: ${message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && !isNoise(message.text())) {
      errors.push(`${label} [${phase}]: ${message.text()}`)
    }
  })
}

// Every request under /api/ plus the page navigations, with ALL headers:
// Playwright's `request.headers()` omits cookie and other security headers,
// so only `allHeaders()` can prove a cookie is absent.
const requests = []
const trackRequests = (page) => {
  page.on('request', (request) => {
    const url = new URL(request.url())
    const navigation = request.isNavigationRequest() && request.resourceType() === 'document'
    if (!url.pathname.startsWith('/api/') && !navigation) return
    requests.push(
      request.allHeaders().then((headers) => ({
        url: request.url(),
        method: request.method(),
        navigation,
        headers,
      })),
    )
  })
}
const apiRequestsSince = async (mark) => {
  const settled = await Promise.all(requests.slice(mark))
  return settled.filter((entry) => !entry.navigation)
}

const stubContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await stubContext.addInitScript(MODEL_CONTEXT_STUB)
const page = await stubContext.newPage()
watch(page, 'stub')
trackRequests(page)

const getTools = () => page.evaluate(() => document.modelContext.getTools())
const invoke = (name, args) => page.evaluate(([n, a]) => window.__webmcpInvoke(n, a), [name, args])
const seam = (tool, args) => page.evaluate(([t, a]) => window.__thinkroomWebmcp.execute(t, a), [tool, args])
const requestTool = (name, url, overrides = {}) => ({
  name,
  description: 'hand-built test tool',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  annotations: { read_only_hint: false, untrusted_content_hint: false },
  kind: 'request',
  include_viewer_context: false,
  request: { method: 'POST', url, path_params: [], body_params: [], agent_identity: 'omit', ...overrides.request },
  ...overrides,
})

try {
  phase = 'create document'
  const created = await fetch(`${BASE}/api/docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Name': 'webmcp-check' },
    body: JSON.stringify({
      title: 'WebMCP check',
      format: 'markdown',
      content: '# WebMCP check\n\nA paragraph about provenance.\n\nA second paragraph to comment on.\n',
    }),
  })
  assert(created.status === 201, 'seed document created through the API')
  const { slug } = await created.json()

  // Establish the guest session (owner_token cookie) before any tool request
  // so the no-cookie assertion below is a real negative.
  phase = 'index'
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { name: 'Your documents' }).waitFor()
  await page.waitForFunction(() => (window.__webmcpToolchange ?? 0) >= 2)
  const indexTools = await getTools()
  assert(sameSet(indexTools.map((t) => t.name), INDEX_TOOLS), 'index registers exactly the two index tools')
  assert(
    indexTools.every((t) => t.description.length > 0 && t.inputSchema?.type === 'object'),
    'index tools carry descriptions and object schemas',
  )

  phase = 'document page registration'
  await page.goto(`${BASE}/d/${slug}/edit`)
  await waitForLive(page)
  const navigation = (await Promise.all(requests)).find((r) => r.navigation && r.url.includes(`/d/${slug}`))
  assert(navigation && typeof navigation.headers.cookie === 'string' && navigation.headers.cookie.length > 0,
    'the tab holds a session cookie (so a cookie-less tool request is a real negative)')
  const docTools = await getTools()
  assert(sameSet(docTools.map((t) => t.name), DOCUMENT_TOOLS), 'document page registers exactly the ten document tools (writable edit link)')
  assert(
    docTools.every((t) => t.description.length > 0 && t.inputSchema?.type === 'object'),
    'document tools carry descriptions and object schemas',
  )
  const readTool = docTools.find((t) => t.name === 'thinkroom_read_document')
  assert(readTool.annotations?.readOnlyHint === true && readTool.annotations?.untrustedContentHint === true,
    'read_document maps read-only and untrusted-content hints to the spec annotations')
  assert(await page.evaluate(() => typeof window.__thinkroomWebmcp?.execute === 'function'),
    'development seam is installed on the document page')

  // AE1: identity refusal, no network.
  phase = 'AE1'
  let mark = requests.length
  const refusal = parseResult(
    await invoke('thinkroom_propose_suggestion', { body: 'Better text', replaces: 'A paragraph about provenance.' }),
  )
  assert(refusal.isError && refusal.text.includes('agent identity'), 'suggestion without agent_name is refused with the identity message')
  assert((await apiRequestsSince(mark)).length === 0, 'identity refusal makes no API request')

  // AE2 + AE8: agent-attributed suggestion, cookie-less request.
  phase = 'AE2'
  mark = requests.length
  const proposed = parseResult(
    await invoke('thinkroom_propose_suggestion', {
      agent_name: ` ${AGENT} `,
      body: 'A paragraph about agent provenance.',
      replaces: 'A paragraph about provenance.',
      intent: 'name the agent',
    }),
  )
  assert(!proposed.isError && proposed.json?.status === 'pending_human_review', 'suggestion tool returns the 201 body', proposed.text)
  const suggestionRequests = await apiRequestsSince(mark)
  assert(suggestionRequests.length === 1, 'suggestion tool made exactly one API request')
  const [suggestionRequest] = suggestionRequests
  assert(new URL(suggestionRequest.url).origin === ORIGIN && new URL(suggestionRequest.url).pathname.startsWith('/api/'),
    'tool request is same-origin under /api/')
  assert(suggestionRequest.headers.cookie === undefined && suggestionRequest.headers.authorization === undefined,
    'tool request carries no Cookie and no Authorization header (AE8)')
  assert(suggestionRequest.headers['x-agent-name'] === AGENT, 'agent_name is trimmed into X-Agent-Name')
  const card = page.locator('.margin-card', { hasText: AGENT })
  await card.waitFor({ timeout: 10000 })
  assert((await card.locator('.author-chip--agent').count()) >= 1, 'pending suggestion card shows the agent chip for Scout')

  phase = 'accepted attribution'
  await card.locator('.btn-accept').click()
  await page
    .locator(`.milkdown .ProseMirror [data-provenance][data-kind="ai"][data-author="${AGENT}"]`)
    .waitFor({ timeout: 10000 })
  assert(true, 'accepted text carries data-kind="ai" data-author="Scout" provenance')

  // AE9: comment then resolve.
  phase = 'AE9'
  const commented = parseResult(
    await invoke('thinkroom_comment', { agent_name: AGENT, body: 'Could we cite a source here?', anchor_text: 'second paragraph' }),
  )
  assert(!commented.isError && commented.json?.comment?.id, 'comment tool returns the comment JSON', commented.text)
  const commentCard = page.locator('.comment-card', { hasText: 'cite a source' })
  await commentCard.waitFor({ timeout: 10000 })
  assert((await commentCard.locator('.author-chip--agent').count()) >= 1, 'comment card shows the agent chip for Scout')
  const resolved = parseResult(await invoke('thinkroom_resolve_comment', { agent_name: AGENT, id: String(commented.json.comment.id) }))
  assert(!resolved.isError && resolved.json?.comment?.id === commented.json.comment.id, 'resolve_comment substitutes the id and returns the comment')
  // Resolved comments collapse behind a toggle; the open card must be gone
  // and the resolved list must hold it once expanded.
  await commentCard.waitFor({ state: 'detached', timeout: 10000 })
  await page.locator('.comment-resolved-toggle').click()
  await page.locator('.comment-card.is-resolved', { hasText: 'cite a source' }).waitFor({ timeout: 10000 })
  assert(true, 'resolved comment leaves the open list and appears in the resolved list')

  // AE4: create an unclaimed, agent-attributed draft.
  phase = 'AE4'
  const createdByTool = parseResult(
    await invoke('thinkroom_create_document', { agent_name: AGENT, title: 'Created by WebMCP', format: 'markdown', content: '# From a browser agent\n\nHello.' }),
  )
  assert(!createdByTool.isError && typeof createdByTool.json?.share_url === 'string', 'create_document returns the 201 body with share_url', createdByTool.text)
  const createdState = await (await fetch(`${BASE}/api/docs/${createdByTool.json.slug}`)).json()
  assert(createdState.provenance?.seed_author_kind === 'agent' && createdState.provenance?.seed_author_name === AGENT,
    'created document records agent seed attribution')
  assert(createdState.ownership?.claimed === false, 'created document is unclaimed')

  // read_document: viewer context and secret-free results.
  phase = 'read_document'
  const csrf = await page.evaluate(() => document.querySelector('meta[name="csrf-token"]')?.content ?? '')
  const cookieValues = (await stubContext.cookies(BASE)).map((c) => c.value).filter((v) => v.length > 8)
  const read = parseResult(await invoke('thinkroom_read_document', {}))
  assert(!read.isError && typeof read.json?.plain_text === 'string', 'read_document returns the API state', read.text)
  assert(read.json.viewer_context?.mode === 'edit' && typeof read.json.viewer_context?.note === 'string',
    'read_document result carries viewer_context.mode and a note')
  assert(sameSet(Object.keys(read.json.viewer_context), ['ownership', 'mode', 'share_url', 'note']),
    'viewer_context keys are exactly ownership, mode, share_url, note')
  const guide = parseResult(await invoke('thinkroom_guide', {}))
  for (const [label, text] of [['read_document', read.text], ['guide', guide.text]]) {
    assert(!(csrf && text.includes(csrf)) && !cookieValues.some((v) => text.includes(v)),
      `${label} result contains no CSRF token or cookie value`)
  }

  // AE10: in-page whole-document replacement on the unclaimed edit-link page.
  phase = 'AE10'
  mark = requests.length
  const updateIdentity = parseResult(await invoke('thinkroom_update_document', { content: '# Nope' }))
  assert(updateIdentity.isError && updateIdentity.text.includes('agent identity'), 'update_document without agent_name is refused with the identity message')
  const blank = parseResult(await invoke('thinkroom_update_document', { agent_name: AGENT, content: '   ' }))
  assert(blank.isError && blank.text.includes('empty'), 'update_document with blank content is refused', blank.text)
  const beforeUpdate = await (await fetch(`${BASE}/api/docs/${slug}`)).json()
  assert(beforeUpdate.plain_text.includes('WebMCP check'), 'refusals left the document unchanged')
  const stale = parseResult(
    await invoke('thinkroom_propose_suggestion', { agent_name: AGENT, body: 'A third paragraph.', replaces: 'A second paragraph to comment on.', intent: 'will go stale' }),
  )
  assert(!stale.isError, 'a pending suggestion exists before the replacement', stale.text)
  mark = requests.length
  const updated = parseResult(
    await invoke('thinkroom_update_document', {
      agent_name: AGENT,
      content: '# Rewritten by Scout\n\n<ins data-suggestion-id="stale">Fresh body.</ins>\n',
    }),
  )
  assert(!updated.isError && updated.json?.ok === true, 'update_document replaces the document', updated.text)
  assert(updated.json.persisted === true && updated.json.title === 'Rewritten by Scout',
    'update_document result reports persisted: true and the derived title', updated.text)
  assert(typeof updated.json.previous_content === 'string' && updated.json.previous_content.includes('WebMCP check'),
    'update_document result returns the previous source for recovery')
  assert(updated.json.auto_rejected_suggestions === 1, 'the pending suggestion whose text vanished is auto-rejected', updated.text)
  assert((await apiRequestsSince(mark)).length === 0, 'update_document made no API request')
  await page
    .locator(`.milkdown .ProseMirror [data-provenance][data-kind="ai"][data-author="${AGENT}"]`, { hasText: 'Fresh body' })
    .waitFor({ timeout: 10000 })
  assert((await page.locator('.milkdown .ProseMirror [data-suggestion-id]').count()) === 0,
    'stale suggestion markup in the new source is stripped')
  await page.waitForFunction(() => document.title.includes('Rewritten by Scout'), null, { timeout: 10000 })
  assert(true, 'the first heading of the replacement becomes the page title')
  const afterUpdate = await (await fetch(`${BASE}/api/docs/${slug}`)).json()
  assert(afterUpdate.plain_text.includes('Fresh body') && !afterUpdate.plain_text.includes('WebMCP check'),
    'the API reads the replaced content right after the awaited result')
  assert((afterUpdate.recent_activity ?? []).some((a) => a.action === 'updated_document' && a.actor_kind === 'agent' && a.actor_name === AGENT),
    'the replacement is logged to the activity feed as the agent')
  const spans = afterUpdate.provenance?.spans ?? []
  assert(spans.length > 0 && spans.every((s) => s.kind === 'ai' && s.author === AGENT),
    'every persisted provenance span is ai/Scout after the replacement', JSON.stringify(spans).slice(0, 300))
  assert((afterUpdate.pending_suggestions ?? []).length === 0, 'no pending suggestion survives the replacement')

  // Snapshot failure: the edit is applied but the agent is told it did not persist.
  phase = 'AE10 snapshot failure'
  await page.route(`**/d/${slug}/snapshot`, (route) => route.fulfill({ status: 503, body: 'down' }))
  const unpersisted = parseResult(
    await invoke('thinkroom_update_document', { agent_name: AGENT, content: '# Rewritten by Scout\n\nFresh body, second pass.\n' }),
  )
  await page.unroute(`**/d/${slug}/snapshot`)
  assert(!unpersisted.isError && unpersisted.json?.ok === true && unpersisted.json?.persisted === false,
    'a failed snapshot reports ok with persisted: false', unpersisted.text)
  assert(typeof unpersisted.json.persistence_note === 'string' && unpersisted.json.snapshot_status === 503 && unpersisted.json.auto_rejected_suggestions === undefined,
    'a failed snapshot carries persistence_note and snapshot_status and no auto-reject count', unpersisted.text)
  assert(unpersisted.json.note.includes('Not logged'), 'the note says no activity entry was recorded', unpersisted.json.note)
  await page.locator('.milkdown .ProseMirror', { hasText: 'second pass' }).waitFor({ timeout: 10000 })
  assert(true, 'the editor still shows the replacement after a failed snapshot')

  // AE7: the guest claims the draft and becomes the owner.
  phase = 'AE7'
  await page.getByRole('button', { name: 'Claim this doc' }).click()
  await page.waitForFunction(async () => {
    const result = await window.__webmcpInvoke('thinkroom_read_document', {})
    return JSON.parse(result.content[0].text).viewer_context?.ownership?.yours === true
  }, null, { timeout: 15000 })
  assert(true, 'after claiming, read_document reports viewer_context.ownership.yours = true')

  // A second, non-owner tab on the still-Edit link registers the update tool.
  phase = 'non-owner edit link'
  const otherContext = await browser.newContext()
  await otherContext.addInitScript(MODEL_CONTEXT_STUB)
  const other = await otherContext.newPage()
  watch(other, 'other')
  await other.goto(`${BASE}/d/${slug}`)
  await waitForLive(other)
  await other.waitForFunction(() => (window.__webmcpToolchange ?? 0) >= 1)
  const otherTools = (await other.evaluate(() => document.modelContext.getTools())).map((t) => t.name)
  assert(otherTools.includes('thinkroom_update_document'), 'a non-owner on the Edit link is offered update_document')

  // AE3: owner sets the link to View; the anonymous tool is now locked out of comments.
  phase = 'AE3'
  await page.getByRole('button', { name: 'More options' }).click()
  const accessOptions = page.locator('.header-menu-access-option')
  await accessOptions.first().waitFor({ timeout: 10000 })
  await accessOptions.nth(2).click()
  await page.waitForFunction(
    () => document.querySelectorAll('.header-menu-access-option')[2]?.getAttribute('aria-checked') === 'true',
  )
  await page.keyboard.press('Escape')
  const locked = parseResult(await invoke('thinkroom_comment', { agent_name: AGENT, body: 'Locked out?' }))
  assert(locked.isError && locked.json?.status === 423 && locked.json?.link_access === 'view' && typeof locked.json?.next_action === 'string',
    'comment on a view link returns the 423 body with link_access and next_action', locked.text)
  const readAfterLock = parseResult(await invoke('thinkroom_read_document', {}))
  assert(!readAfterLock.isError, 'read_document still succeeds on a view link')

  // Live revocation: the already-registered tool in the non-owner tab refuses
  // once the link is View, and a reload no longer registers it at all.
  phase = 'revocation'
  await other.waitForFunction(async () => {
    const result = await window.__webmcpInvoke('thinkroom_read_document', {})
    return JSON.parse(result.content[0].text).viewer_context?.ownership?.can_write === false
  }, null, { timeout: 15000 })
  const revoked = parseResult(
    await other.evaluate(([n, a]) => window.__webmcpInvoke(n, a), ['thinkroom_update_document', { agent_name: AGENT, content: '# Hijack\n\nNope.' }]),
  )
  assert(revoked.isError && revoked.text.includes('no longer allows editing'), 'update_document refuses after write access is revoked', revoked.text)
  const afterRevoke = await (await fetch(`${BASE}/api/docs/${slug}`)).json()
  assert(!afterRevoke.plain_text.includes('Hijack'), 'a revoked replacement never reaches the document')
  await other.reload()
  await waitForLive(other)
  await other.waitForFunction(() => (window.__webmcpToolchange ?? 0) >= 1)
  const reloadedTools = (await other.evaluate(() => document.modelContext.getTools())).map((t) => t.name)
  assert(!reloadedTools.includes('thinkroom_update_document'), 'a View link does not register update_document')
  await otherContext.close()

  // Interpreter refusals through the development seam: zero API requests.
  phase = 'refusals'
  const refusals = [
    ['path param "../docs"', requestTool('t_path', `${ORIGIN}/api/docs/${slug}/comments/:id/resolve`, { request: { path_params: ['id'], agent_identity: 'required' } }), { agent_name: AGENT, id: '../docs' }],
    ['emoji agent_name', requestTool('t_emoji', `${ORIGIN}/api/docs/${slug}/comments`, { request: { agent_identity: 'required', body_params: ['body'] } }), { agent_name: 'Sc🙂ut', body: 'x' }],
    ['off-origin URL', requestTool('t_origin', 'https://evil.example/api/x'), {}],
    ['/documents (web controller)', requestTool('t_web', `${ORIGIN}/documents`), {}],
    ['/api/cli/tokens', requestTool('t_cli', `${ORIGIN}/api/cli/tokens`), {}],
    ['/api/uploads', requestTool('t_upload', `${ORIGIN}/api/uploads`), {}],
    [
      'multibyte body over the byte cap',
      requestTool('t_bytes', `${ORIGIN}/api/docs/${slug}/comments`, {
        input_schema: { type: 'object', properties: { body: { type: 'string', maxLength: 10 } }, required: ['body'], additionalProperties: false },
        request: { agent_identity: 'required', body_params: ['body'] },
      }),
      { agent_name: AGENT, body: 'ééééééé' },
    ],
  ]
  for (const [label, tool, args] of refusals) {
    mark = requests.length
    const result = parseResult(await seam(tool, args))
    assert(result.isError, `seam refuses ${label}`, result.text)
    assert((await apiRequestsSince(mark)).length === 0, `${label} made no API request`)
  }
  const thrown = parseResult(await seam(null, {}))
  assert(thrown.isError, 'a throwing execution becomes an isError envelope')

  phase = 'non-JSON and unreachable'
  const html404 = parseResult(await seam(requestTool('t_html', `${ORIGIN}/api/definitely-not-a-route`), {}))
  assert(html404.isError && html404.json?.status === 404 && typeof html404.json?.body === 'string',
    'an HTML 404 body is wrapped as a string with its status, not spread', html404.text)
  await page.route('**/api/docs/unreachable-check', (route) => route.abort('failed'))
  const unreachable = parseResult(await seam(requestTool('t_down', `${ORIGIN}/api/docs/unreachable-check`), {}))
  assert(unreachable.isError && unreachable.json?.error === 'unreachable', 'a failed network request yields "unreachable"', unreachable.text)
  await page.unroute('**/api/docs/unreachable-check')

  // Cancellation: the agent's per-execution signal must stop a write from
  // committing, not just the page-lifetime signal.
  phase = 'cancellation'
  const cancelledBody = `Cancelled comment ${Date.now()}`
  const cancelled = parseResult(
    await page.evaluate(
      ([body]) => window.__webmcpInvoke('thinkroom_comment', { agent_name: 'Scout', body }, { cancel: true }),
      [cancelledBody],
    ),
  )
  assert(cancelled.isError && cancelled.json?.error === 'cancelled', 'a cancelled tool call returns the cancelled envelope', cancelled.text)
  const afterCancel = await (await fetch(`${BASE}/api/docs/${slug}`)).json()
  assert(!afterCancel.open_comments.some((c) => c.body === cancelledBody), 'a cancelled comment never reaches the server')

  // AE5: Inertia navigation from the index to a document swaps the tool set.
  phase = 'AE5'
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { name: 'Your documents' }).waitFor()
  const before = await page.evaluate(() => window.__webmcpToolchange ?? 0)
  await page.locator(`a.document-row-title[href="/d/${slug}"]`).first().click()
  await page.waitForURL(new RegExp(`/d/${slug}`))
  await waitForLive(page)
  const after = await page
    .waitForFunction((n) => ((window.__webmcpToolchange ?? 0) > n ? window.__webmcpToolchange : false), before, { timeout: 15000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null)
  const afterRaw = await page.evaluate(() => window.__webmcpToolchange)
  assert(after !== null, `toolchange fired across the Inertia visit (before ${before}, after ${afterRaw})`)
  assert(sameSet((await getTools()).map((t) => t.name), DOCUMENT_TOOLS), 'after navigating index → document, the registered set is the document set')
  await page.goto(`${BASE}/login`)
  assert(await page.evaluate(() => window.__thinkroomWebmcp === undefined), 'development seam is removed when leaving a tool page')

  // AE6: a browser without modelContext sees no change and no hydration errors.
  phase = 'AE6'
  const plainContext = await browser.newContext()
  const plain = await plainContext.newPage()
  const plainErrors = []
  plain.on('pageerror', (error) => plainErrors.push(String(error)))
  plain.on('console', (message) => {
    if (message.type() === 'error') plainErrors.push(message.text())
  })
  // A fresh document rather than /d/demo: a long-lived local demo can carry
  // stale assets whose 404s have nothing to do with WebMCP.
  await plain.goto(`${BASE}/d/${createdByTool.json.slug}`)
  await waitForLive(plain)
  await plain.goto(`${BASE}/`)
  await plain.getByRole('heading', { name: 'Your documents' }).waitFor()
  assert(plainErrors.length === 0, 'pages load with no console errors without WebMCP', plainErrors.join(' | '))
  assert(!plainErrors.some((e) => e.includes('Hydration failed')), 'no hydration failure without WebMCP')
  await plainContext.close()

  if (errors.length) {
    throw new Error(`unexpected browser errors:\n${errors.join('\n')}`)
  }
  console.log('webmcp_check: all scenarios passed')
} catch (error) {
  console.error(`✗ [${phase}] ${error.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
