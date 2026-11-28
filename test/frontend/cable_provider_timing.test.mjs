import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
      const file = path.resolve(path.dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`)
      if (existsSync(file)) return nextResolve(pathToFileURL(file).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const windowListeners = new Map()
globalThis.window = {
  addEventListener: (event, handler) => windowListeners.set(event, handler),
  removeEventListener: (event) => windowListeners.delete(event),
}
globalThis.document = { querySelector: () => ({ content: 'test-csrf-token' }) }

const { CableProvider } = await import('../../app/frontend/editor/cable_provider.ts')

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64')
const fromBase64 = (text) => new Uint8Array(Buffer.from(text, 'base64'))

// Time stands still until the test moves it, so each assertion names the exact
// millisecond a frame is due.
function connect(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  t.mock.method(console, 'warn', () => {})
  const doc = new Y.Doc()
  const sent = []
  const subscription = {
    identifier: 'initial',
    send: (frame) => sent.push({ ...frame, text: doc.getText('t').toString() }),
    unsubscribe() {},
  }
  let callbacks
  const consumer = {
    subscriptions: {
      create(params, handlers) {
        callbacks = handlers
        subscription.params = params
        return subscription
      },
    },
  }
  const provider = new CableProvider(doc, 'demo', {
    consumer, ackTimeoutMs: 10_000, retryBaseMs: 250, retryMaxMs: 1_000, seedRetryMs: 3_000, ...options,
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }))
  t.after(() => provider.destroy())
  const of = (...types) => sent.filter(({ type }) => types.includes(type))
  return {
    doc, provider, subscription,
    updates: () => of('update', 'sync-reply'),
    presence: () => of('awareness'),
    requests: () => of('seed-request'),
    tick: (ms) => t.mock.timers.tick(ms),
    type: (text) => doc.getText('t').insert(doc.getText('t').length, text),
    receive: (frame) => callbacks.received(frame),
    disconnect: () => callbacks.disconnected(),
    reject: () => callbacks.rejected(),
  }
}

function handshake(extra = {}) {
  const empty = new Y.Doc()
  return {
    type: 'sync',
    update: toBase64(Y.encodeStateAsUpdate(empty)),
    sv: toBase64(Y.encodeStateVector(empty)),
    generation: 1,
    ...extra,
  }
}

function textOf(frames) {
  const server = new Y.Doc()
  for (const { update } of frames) Y.applyUpdate(server, fromBase64(update))
  return server.getText('t').toString()
}

function assertSendsAfter(h, count, ms) {
  h.tick(ms - 1)
  assert.equal(h.updates().length, count, `nothing before ${ms} ms`)
  h.tick(1)
  assert.equal(h.updates().length, count + 1, `one frame at ${ms} ms`)
}

const refuse = (h) => h.receive({ type: 'nack', seq: h.updates().at(-1).seq, reason: 'retryable' })
const accept = (h) => h.receive({ type: 'ack', seq: h.updates().at(-1).seq })

test('retries wait twice as long each time up to the maximum, and any settled edit starts over', async (t) => {
  const endings = {
    'a receipt': accept,
    'a final refusal': (h) => h.receive({ type: 'nack', seq: h.updates().at(-1).seq, reason: 'invalid' }),
    'a stored save': async (h) => {
      h.provider.persistCurrentState()
      for (let i = 0; i < 20; i += 1) await null
    },
    'a locked document': (h) => h.receive({ type: 'write-denied' }),
    'a new handshake': (h) => h.receive(handshake()),
  }
  const h = connect(t)
  h.receive(handshake())
  for (const [name, end] of Object.entries(endings)) {
    h.type('a')
    for (const delay of [250, 500, 1_000, 1_000]) {
      const count = h.updates().length
      refuse(h)
      assertSendsAfter(h, count, delay)
    }
    await end(h)
    h.type('b')
    const count = h.updates().length
    refuse(h)
    assertSendsAfter(h, count, 250)
    accept(h)
    if (h.provider.inFlight) accept(h)
    assert.equal(h.provider.inFlight, null, name)
  }
})

test('a receipt that never comes is waited for, then the edit waits its backoff and goes out again', (t) => {
  const h = connect(t)
  h.receive(handshake())
  h.type('a')
  h.tick(9_999)
  assert.ok(h.provider.inFlight)
  h.tick(1)
  assert.equal(h.provider.inFlight, null)
  assertSendsAfter(h, 1, 250)

  accept(h)
  h.tick(60_000)
  assert.equal(h.updates().length, 2, 'a received answer ends the wait')
})

test('the wait for a receipt belongs to one frame, and ends with it', (t) => {
  const h = connect(t)
  h.receive(handshake())
  h.type('a')
  h.tick(6_000)
  accept(h)
  h.type('b')
  h.tick(6_000)
  assert.ok(h.provider.inFlight, 'the first frame’s wait does not time out the second')
  h.disconnect()
  h.receive(handshake())
  h.tick(6_000)
  assert.ok(h.provider.inFlight, 'a wait from before the drop does not time out the resend')
  h.disconnect()
  h.tick(60_000)
  assert.equal(h.updates().length, 3)
})

test('edits typed during a backoff wait for it', (t) => {
  const h = connect(t)
  h.receive(handshake())
  h.type('a')
  refuse(h)
  h.type('b')
  assertSendsAfter(h, 1, 250)
  assert.equal(textOf(h.updates().slice(1)), 'ab')
})

test('a disconnect or a new handshake ends a backoff and the edit goes out once', (t) => {
  const h = connect(t)
  h.receive(handshake())
  h.type('a')
  refuse(h)
  h.disconnect()
  h.tick(60_000)
  assert.equal(h.updates().length, 1)
  h.receive(handshake())
  assert.deepEqual(h.updates().map(({ type, seq }) => [type, seq]), [['update', 1], ['sync-reply', 1]])

  refuse(h)
  h.receive(handshake())
  assert.equal(h.updates().length, 3)
  accept(h)
  h.tick(60_000)
  assert.equal(h.updates().length, 3)
})

test('a deleted document or a locked one ends the backoff and the wait for a receipt', (t) => {
  for (const [backoff, end] of [
    [true, (h) => h.reject()],
    [false, (h) => h.reject()],
    [true, (h) => h.receive({ type: 'write-denied' })],
    [false, (h) => h.receive({ type: 'write-denied' })],
  ]) {
    t.mock.timers.reset()
    const h = connect(t)
    h.receive(handshake())
    h.type('a')
    if (backoff) refuse(h)
    end(h)
    h.tick(60_000)
    assert.equal(h.updates().length, 1)
    assert.equal(h.provider.queued.length, 0)
  }

  t.mock.timers.reset()
  const h = connect(t)
  h.receive(handshake())
  h.type('a')
  refuse(h)
  h.receive({ type: 'write-denied' })
  h.type('b')
  assert.equal(h.updates().length, 2, 'a later edit does not sit out the old backoff')
})

test('after a destroy no timer sends anything', (t) => {
  for (const prepare of [(h) => refuse(h), () => {}, (h) => h.provider.awareness.setLocalState({ user: {} })]) {
    t.mock.timers.reset()
    const h = connect(t)
    h.receive(handshake())
    h.type('a')
    prepare(h)
    h.provider.destroy()
    const [updates, presence] = [h.updates().length, h.presence().length]
    h.tick(60_000)
    assert.deepEqual([h.updates().length, h.presence().length], [updates, presence])
  }
})

test('edits too large for one frame leave oldest first after a drop', (t) => {
  const h = connect(t)
  h.receive(handshake())
  for (const letter of ['a', 'b', 'c']) h.type(letter.repeat(900_000))
  h.disconnect()
  h.receive(handshake())
  assert.ok(textOf([h.updates()[1]]) === 'a'.repeat(900_000))
})

function holdSaves(t) {
  const calls = []
  t.mock.method(globalThis, 'fetch', (_url, { body, keepalive }) =>
    new Promise((resolve, reject) => {
      calls.push({ bytes: Buffer.byteLength(body), body: JSON.parse(body), keepalive, fail: () => reject(new Error('offline')) })
    }),
  )
  t.after(() => calls.forEach(({ fail }) => fail()))
  return calls
}

test('a save takes keepalive only within 64 KiB, and a snapshot only within 60', async (t) => {
  const h = connect(t)
  const calls = holdSaves(t)
  const settle = async () => {
    calls.at(-1).fail()
    for (let i = 0; i < 20; i += 1) await null
  }
  const snapshot = (length) => ({ content: 's'.repeat(length), spans: [], state_vector: '' })
  h.provider.persistCurrentState(snapshot(0))
  const empty = calls[0].bytes
  await settle()
  for (const [bytes, included] of [[60 * 1024, true], [60 * 1024 + 1, false]]) {
    h.provider.persistCurrentState(snapshot(bytes - empty))
    assert.equal('content' in calls.at(-1).body, included, `${bytes} bytes`)
    await settle()
  }

  h.type('x'.repeat(49_300))
  h.provider.persistCurrentState()
  assert.ok(calls.at(-1).bytes > 64 * 1024 && calls.at(-1).bytes < 65 * 1024)
  assert.equal(calls.at(-1).keepalive, false)
})

test('a large edit whose save failed is sent again when the page closes', async (t) => {
  const h = connect(t)
  const calls = holdSaves(t)
  h.type('x'.repeat(100_000))
  h.provider.persistCurrentState()
  calls[0].fail()
  for (let i = 0; i < 20; i += 1) await null
  windowListeners.get('pagehide')()
  assert.equal(calls.length, 2)
  assert.equal(textOf([calls[1].body]).length, 100_000)
})

test('an edit the server refuses for good is dropped and the next one goes out at once', (t) => {
  const h = connect(t)
  h.receive(handshake())
  h.type('a')
  h.doc.getText('other').insert(0, 'b')
  h.receive({ type: 'nack', seq: 1, reason: 'invalid' })
  assert.equal(h.updates().length, 2)
  assert.equal(textOf([h.updates()[1]]), '', 'the refused edit is not sent again')
  assert.equal(h.provider.queued.length, 0)
})

test('a receipt applies the held peer edits before the next frame leaves', (t) => {
  const h = connect(t)
  h.receive(handshake({ seed: true, seed_content: 'x', seed_claim: 'claim' }))
  h.type('seed')
  h.type('!')
  const peer = new Y.Doc()
  peer.getText('t').insert(0, 'peer')
  h.receive({ type: 'update', update: toBase64(Y.encodeStateAsUpdate(peer)) })
  assert.equal(h.doc.getText('t').toString(), 'seed!')

  accept(h)
  const next = h.updates()[1]
  assert.match(next.text, /peer/)
  assert.ok(!('seed_claim' in next))
})

test('a save stored after the handshake sends what is still queued as an ordinary update', async (t) => {
  const h = connect(t)
  h.receive(handshake())
  h.type('a')
  h.provider.persistCurrentState()
  h.type('b')
  for (let i = 0; i < 20; i += 1) await null
  assert.deepEqual(h.updates().map(({ type, seq }) => [type, seq]), [['update', 1], ['update', 2]])
})

test('a waiting writer asks for the seed after the delay, and again when nobody answers', (t) => {
  const h = connect(t)
  h.receive(handshake({ seed_pending: true }))
  for (const [ms, count] of [[2_999, 0], [1, 1], [10_000, 1], [2_999, 1], [1, 2]]) {
    h.tick(ms)
    assert.equal(h.requests().length, count)
  }
  h.disconnect()
  h.tick(60_000)
  assert.equal(h.requests().length, 2)
})

test('a waiting writer stops asking once the document is gone, superseded or closed', (t) => {
  for (const end of [
    (h) => h.reject(),
    (h) => h.provider.destroy(),
    (h) => h.receive(handshake({ generation: 2 })),
  ]) {
    for (const wait of [0, 3_000]) {
      t.mock.timers.reset()
      const h = connect(t)
      h.receive(handshake({ seed_pending: true }))
      h.tick(wait)
      const count = h.requests().length
      end(h)
      h.tick(60_000)
      assert.equal(h.requests().length, count)
    }
  }
})

test('only the handshake that follows a seed-request counts as its answer', (t) => {
  const h = connect(t)
  h.receive(handshake({ seed_pending: true }))
  h.tick(3_000)
  h.receive(handshake({ seed: true, seed_content: 'x', seed_claim: 'claim' }))
  h.type('a')
  h.receive(handshake())
  assert.deepEqual(h.updates().map(({ seq }) => seq), [1, 2], 'a later handshake resends what is unanswered')
})

test('presence changes inside 100 ms become one frame when they are up', (t) => {
  const h = connect(t)
  h.receive(handshake())
  const before = h.presence().length
  h.tick(40)
  h.provider.awareness.setLocalState({ n: 1 })
  h.provider.awareness.setLocalState({ n: 2 })
  h.tick(59)
  assert.equal(h.presence().length, before)
  h.tick(1)
  assert.equal(h.presence().length, before + 1)

  h.tick(100)
  h.provider.awareness.setLocalState({ n: 3 })
  assert.equal(h.presence().length, before + 2, 'a change after a quiet spell goes at once')
  h.tick(60_000)
  assert.equal(h.presence().length, before + 2)
})

test('leaving the page and losing focus send the waiting presence at once', async (t) => {
  const h = connect(t)
  h.receive(handshake())
  const before = h.presence().length
  h.provider.awareness.setLocalState({ n: 1 })
  windowListeners.get('blur')()
  assert.equal(h.presence().length, before + 1)
  h.provider.awareness.setLocalState({ n: 2 })
  await null
  assert.equal(h.presence().length, before + 2, 'a change made while the window loses focus goes too')

  h.provider.awareness.setLocalState(null)
  assert.equal(h.presence().length, before + 3)
  h.tick(60_000)
  assert.equal(h.presence().length, before + 3)
})

test('presence waiting when the connection drops or the document goes is not sent', (t) => {
  for (const end of ['disconnect', 'reject']) {
    t.mock.timers.reset()
    const h = connect(t)
    h.receive(handshake())
    h.provider.awareness.setLocalState({ n: 1 })
    const before = h.presence().length
    h[end]()
    h.provider.awareness.setLocalState({ n: 2 })
    windowListeners.get('blur')()
    h.tick(60_000)
    assert.equal(h.presence().length, before)
  }
})

test('a peer’s presence is shown but not sent on, and goes when the peer leaves', (t) => {
  const h = connect(t)
  h.receive(handshake())
  h.tick(1_000)
  const peer = new Awareness(new Y.Doc())
  t.after(() => peer.destroy())
  peer.setLocalState({ user: { name: 'Grace' } })
  h.receive({ type: 'awareness', update: toBase64(encodeAwarenessUpdate(peer, [peer.clientID])) })
  assert.ok(h.provider.awareness.getStates().has(peer.clientID))
  assert.equal(h.presence().length, 1)

  h.receive({ type: 'awareness-leave', client_id: peer.clientID })
  h.receive({ type: 'awareness-leave', client_id: h.doc.clientID })
  assert.deepEqual([...h.provider.awareness.getStates().keys()], [h.doc.clientID])
})

test('a reconnect asks only for what this document is missing', (t) => {
  const h = connect(t, { initialChecksum: 'page', initialGeneration: 1 })
  const { channel, slug, cid, client_id, checksum, generation, sv } = h.subscription.params
  assert.deepEqual(
    [channel, slug, cid, client_id, checksum, generation, sv],
    ['SyncChannel', 'demo', h.provider.clientId, h.doc.clientID, 'page', 1, undefined],
  )
  h.receive(handshake({ checksum: 'stored' }))
  h.type('a')
  h.disconnect()
  const params = JSON.parse(h.subscription.identifier)
  assert.equal(params.checksum, 'stored')
  assert.equal(params.generation, 1)
  assert.equal(params.sv, toBase64(Y.encodeStateVector(h.doc)))

  h.receive(handshake({ checksum: 'stored' }))
  const peer = new Y.Doc()
  peer.getText('p').insert(0, 'p')
  h.receive({ type: 'update', update: toBase64(Y.encodeStateAsUpdate(peer)) })
  h.disconnect()
  assert.ok(!('checksum' in JSON.parse(h.subscription.identifier)), 'a peer edit makes the stored checksum old')
})

test('a writer still waiting after a drop asks again after the whole delay', (t) => {
  const h = connect(t)
  h.receive(handshake({ seed_pending: true }))
  h.tick(3_000)
  h.disconnect()
  h.receive(handshake({ seed_pending: true }))
  h.tick(2_999)
  assert.equal(h.requests().length, 1)
  h.tick(1)
  assert.equal(h.requests().length, 2)
})
