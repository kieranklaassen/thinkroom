import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Y from 'yjs'

// One ref per page, so calling the hook again is the page's next render.
const runtime = { reloads: [], provider: null, ref: null }
globalThis.waitingAccessRuntime = runtime

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  react: stub('export const useCallback = (callback) => callback, useRef = (current) => (globalThis.waitingAccessRuntime.ref ??= { current })'),
  '@inertiajs/react': stub('export const router = { reload: (options) => globalThis.waitingAccessRuntime.reloads.push(options) }'),
  '../../editor/collab_session': stub(
    'export const getSession = (slug) => slug === "doc" ? { provider: globalThis.waitingAccessRuntime.provider } : undefined',
  ),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('use_waiting_access.ts') && STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
    if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:')) {
      const file = `${path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)}.ts`
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { useWaitingAccess } = await import('../../app/frontend/pages/documents/use_waiting_access.ts')
const { CableProvider } = await import('../../app/frontend/editor/cable_provider.ts')

const GUEST = { document: { id: 1 }, ownership: { can_write: true }, viewer: { account: null } }
const SIGNED_IN = { document: { id: 1 }, ownership: { can_write: true, yours: true }, viewer: { account: { id: 7 } } }
const PENDING = { type: 'sync', update: '', sv: 'AA==', generation: 1, seed_pending: true }
const base64 = (bytes) => Buffer.from(bytes).toString('base64')

function contentFrame() {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, 'body ')
  return { type: 'update', update: base64(Y.encodeStateAsUpdate(doc)), cid: 'peer' }
}

// A waiting page whose request goes unanswered, with its reload sent.
function waitingPage(t, shown = GUEST, storage = new Map()) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const loads = []
  globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { reload: () => loads.push('load') } }
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  const sent = []
  let callbacks
  const doc = new Y.Doc()
  const provider = new CableProvider(doc, 'doc', {
    seedRetryMs: 5,
    ackTimeoutMs: 10,
    consumer: { subscriptions: { create: (_params, cbs) => {
      callbacks = cbs
      return { send: (frame) => sent.push(frame), unsubscribe() {} }
    } } },
  })
  t.after(() => provider.destroy())
  Object.assign(runtime, { reloads: [], provider, ref: null })
  provider.on('access-changed', useWaitingAccess('doc', shown))
  let synced = 0
  provider.on('synced', () => { synced += 1 })
  callbacks.received(PENDING)
  t.mock.timers.tick(5)
  t.mock.timers.tick(10)
  assert.equal(runtime.reloads.length, 1)
  const answer = (props, reload = 0) => {
    const page = { props: { ...shown, comments: [], ...props } }
    runtime.reloads[reload].onBeforeUpdate(page)
    return page.props
  }
  return { doc, provider, sent, loads, answer, receive: callbacks.received, disconnect: callbacks.disconnected, synced: () => synced, storage }
}

test('a waiting page reads its access quietly', (t) => {
  waitingPage(t)
  const { only, async, onHttpException } = runtime.reloads[0]
  assert.deepEqual(only, ['document', 'ownership', 'viewer'])
  assert.equal(async, true)
  assert.equal(onHttpException({ status: 500 }), false, 'no error dialog over a page that waits')
})

test('a waiting page loads again for another identity, and nothing binds or is sent meanwhile', (t) => {
  const page = waitingPage(t)
  const props = page.answer(SIGNED_IN)
  assert.deepEqual(page.loads, ['load'])
  assert.deepEqual(props, { ...GUEST, comments: [] }, 'applying the answer would open a session on a page going away')

  const sent = page.sent.length
  page.receive(contentFrame())
  page.receive({ ...PENDING, seed_pending: undefined, seed: true, seed_content: '# T', seed_claim: 'c' })
  t.mock.timers.tick(5)
  t.mock.timers.tick(10)
  assert.equal(page.synced(), 0)
  assert.equal(page.provider.seedContent, null)
  assert.equal(page.sent.length, sent)
})

for (const [name, second] of [
  ['the same identity', SIGNED_IN],
  ['changed access alone', { ...GUEST, ownership: { can_write: false } }],
]) {
  test(`a second answer with ${name} is not applied after the page load began`, (t) => {
    const page = waitingPage(t)
    page.receive(PENDING)
    t.mock.timers.tick(5)
    t.mock.timers.tick(10)
    assert.equal(runtime.reloads.length, 2, 'two reloads are outstanding')

    const first = page.answer(SIGNED_IN, 0)
    const later = page.answer(second, 1)
    assert.deepEqual(page.loads, ['load'])
    assert.deepEqual(first, { ...GUEST, comments: [] })
    assert.deepEqual(later, { ...GUEST, comments: [] })
  })
}

test('a sign-in to another account loads a waiting page again', (t) => {
  const page = waitingPage(t, SIGNED_IN)
  page.answer({ ...SIGNED_IN, viewer: { account: { id: 8 } } })
  assert.deepEqual(page.loads, ['load'])
})

test('the identity of the last render decides, not of the first', (t) => {
  const page = waitingPage(t)
  useWaitingAccess('doc', SIGNED_IN)
  page.answer(SIGNED_IN)
  assert.deepEqual(page.loads, [])
})

test('a waiting page that holds text is not loaded again', (t) => {
  const page = waitingPage(t)
  const original = { document: globalThis.document, fetch: globalThis.fetch }
  globalThis.document = { querySelector: () => null }
  globalThis.fetch = async () => ({ ok: true, status: 204 })
  t.after(() => Object.assign(globalThis, original))
  page.doc.getText('t').insert(0, 'local')
  const props = page.answer(SIGNED_IN)
  assert.deepEqual(page.loads, [])
  assert.equal(page.provider.discarded, false)
  assert.deepEqual(props, { ...SIGNED_IN, comments: [] })
})

test('a sign-out loads a waiting page again too', (t) => {
  const page = waitingPage(t, SIGNED_IN)
  page.answer(GUEST)
  assert.deepEqual(page.loads, ['load'])
})

test('content arriving while the access is read keeps the page and its typed text', (t) => {
  const page = waitingPage(t)
  page.receive(contentFrame())
  page.doc.getText('t').insert(5, 'typed')
  page.receive({ type: 'ack', seq: 1 })
  const props = page.answer(SIGNED_IN)
  assert.deepEqual(page.loads, [])
  assert.deepEqual(props, { ...SIGNED_IN, comments: [] }, 'the answer is applied')
  assert.equal(page.doc.getText('t').toString(), 'body typed')
  assert.equal(page.provider.discarded, false)
  assert.ok(page.sent.some((frame) => frame.type === 'update'))
  assert.equal(page.storage.size, 0)
})

test('an unchanged identity never loads the page again, whatever its access', (t) => {
  const page = waitingPage(t)
  const props = page.answer({ ...GUEST, ownership: { can_write: false } })
  assert.deepEqual(page.loads, [])
  assert.equal(props.ownership.can_write, false, 'the changed access is applied')
  assert.equal(page.provider.discarded, false)
})

test('a page that lost its connection while the access is read is not loaded again', (t) => {
  const page = waitingPage(t)
  page.disconnect()
  page.answer(SIGNED_IN)
  assert.deepEqual(page.loads, [])
})

test('a load that did not bring the identity is not repeated; another change loads again', (t) => {
  const storage = new Map()
  const answered = (shown, props) => {
    t.mock.timers.reset()
    const page = waitingPage(t, shown, storage)
    const applied = page.answer(props)
    return { loads: page.loads.length, applied: applied.viewer === props.viewer }
  }
  assert.deepEqual(answered(GUEST, SIGNED_IN), { loads: 1, applied: false })
  assert.deepEqual(answered(GUEST, SIGNED_IN), { loads: 0, applied: true })
  assert.deepEqual(answered(GUEST, SIGNED_IN), { loads: 0, applied: true })
  assert.deepEqual(answered(SIGNED_IN, GUEST), { loads: 1, applied: false })
  assert.deepEqual(answered(GUEST, SIGNED_IN), { loads: 1, applied: false })
})

test('without storage the page is not loaded again', (t) => {
  const page = waitingPage(t)
  globalThis.sessionStorage = { getItem() { throw new Error('blocked') } }
  const props = page.answer(SIGNED_IN)
  assert.deepEqual(page.loads, [])
  assert.deepEqual(props, { ...SIGNED_IN, comments: [] })
})
