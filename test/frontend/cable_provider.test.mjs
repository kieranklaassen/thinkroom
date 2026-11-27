import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Y from 'yjs'

// Resolve Vite/TS extensionless relative imports (../lib/cable -> ../lib/cable.ts)
// so Node's native TypeScript execution can load app/frontend modules directly.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith('file:')
    ) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
        if (existsSync(base + ext)) {
          return nextResolve(pathToFileURL(base + ext).href, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
})

// Minimal browser globals touched by CableProvider / csrfToken / beforeunload.
const windowListeners = new Map()
globalThis.window ??= {
  addEventListener(event, handler) {
    if (!windowListeners.has(event)) windowListeners.set(event, new Set())
    windowListeners.get(event).add(handler)
  },
  removeEventListener(event, handler) {
    windowListeners.get(event)?.delete(handler)
  },
  dispatchEvent(event) {
    windowListeners.get(event)?.forEach((handler) => handler())
  },
}
globalThis.document ??= {
  querySelector: () => ({ content: 'test-csrf-token' }),
}

const { CableProvider, SERVER_HYDRATE_ORIGIN } = await import(
  '../../app/frontend/editor/cable_provider.ts'
)

const { splitUpdate } = await import('../../app/frontend/editor/split_update.ts')

const toBase64 = (u8) => Buffer.from(u8).toString('base64')
const fromBase64 = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))

function createHarness(t, options = {}) {
  const doc = options.doc ?? new Y.Doc()
  const sent = []
  const waiters = []
  let callbacks = null
  let unsubscribed = false

  const isUpdateFrame = (frame) => frame.type === 'update' || frame.type === 'sync-reply'

  const consumer = {
    subscriptions: {
      create(_params, cbs) {
        callbacks = cbs
        return {
          send(payload) {
            sent.push(payload)
            if (isUpdateFrame(payload)) {
              const count = sent.filter(isUpdateFrame).length
              for (let i = waiters.length - 1; i >= 0; i -= 1) {
                if (count >= waiters[i].count) {
                  waiters[i].resolve(payload)
                  waiters.splice(i, 1)
                }
              }
            }
          },
          unsubscribe() {
            unsubscribed = true
          },
        }
      },
    },
  }

  const provider = new CableProvider(doc, 'demo-slug', {
    consumer,
    ackTimeoutMs: 500,
    retryBaseMs: 25,
    retryMaxMs: 100,
    ...options,
  })

  // Always destroy provider (clearing ACK/retry timers and Awareness interval)
  // even when an assertion fails so Node's event loop can exit cleanly.
  t.after(() => provider.destroy())

  const sentUpdates = () => sent.filter(isUpdateFrame)
  const waitForUpdateCount = (count, timeoutMs = 2000) => {
    const existing = sentUpdates()
    if (existing.length >= count) return Promise.resolve(existing[count - 1])
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${count} sent updates (have ${sentUpdates().length})`)),
        timeoutMs,
      )
      waiters.push({
        count,
        resolve: (frame) => {
          clearTimeout(timer)
          resolve(frame)
        },
      })
    })
  }

  return {
    doc,
    provider,
    sent,
    sentUpdates,
    waitForUpdateCount,
    receive: (msg) => callbacks.received(msg),
    disconnect: () => callbacks.disconnected(),
    reject: () => callbacks.rejected(),
    isUnsubscribed: () => unsubscribed,
  }
}

function emptySyncFrame(generation = 0) {
  const empty = new Y.Doc()
  return {
    type: 'sync',
    update: toBase64(Y.encodeStateAsUpdate(empty)),
    sv: toBase64(Y.encodeStateVector(empty)),
    generation,
  }
}

test('single-in-flight coalescing outbox sends one frame at a time and merges queued edits on ACK', (t) => {
  const h = createHarness(t)
  h.receive(emptySyncFrame(1))

  // Edit 1 flushes immediately as seq 1.
  h.doc.getText('t').insert(0, 'A')
  assert.equal(h.sentUpdates().length, 1)
  assert.equal(h.sentUpdates()[0].seq, 1)
  assert.equal(h.sentUpdates()[0].generation, 1)

  // Edits 2, 3, 4 occur while seq 1 is in flight — must coalesce, never send concurrently.
  h.doc.getText('t').insert(1, 'B')
  h.doc.getText('t').insert(2, 'C')
  h.doc.getText('t').insert(3, 'D')
  assert.equal(h.sentUpdates().length, 1)

  // Stale/mismatched ACK is ignored.
  h.receive({ type: 'ack', seq: 99 })
  assert.equal(h.sentUpdates().length, 1)

  // Matching ACK for seq 1 immediately flushes the single coalesced batch as seq 2.
  h.receive({ type: 'ack', seq: 1 })
  assert.equal(h.sentUpdates().length, 2)
  assert.equal(h.sentUpdates()[1].seq, 2)

  // Applying the two transmitted frames to a fresh doc reproduces the exact full state.
  const serverDoc = new Y.Doc()
  for (const frame of h.sentUpdates()) {
    Y.applyUpdate(serverDoc, fromBase64(frame.update))
  }
  assert.equal(serverDoc.getText('t').toString(), 'ABCD')

  h.receive({ type: 'ack', seq: 2 })
})

test('read-only hydrated open with deletion history sends zero update or sync-reply frames', (t) => {
  const serverDoc = new Y.Doc()
  serverDoc.getText('t').insert(0, 'hello world')
  serverDoc.getText('t').delete(5, 6) // non-empty delete set
  const fullState = Y.encodeStateAsUpdate(serverDoc)
  const sv = Y.encodeStateVector(serverDoc)

  const localDoc = new Y.Doc()
  Y.applyUpdate(localDoc, fullState, SERVER_HYDRATE_ORIGIN)

  const fetchCalls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init })
    return { ok: true, status: 204 }
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const h = createHarness(t, { doc: localDoc })
  h.receive({ type: 'sync', update: toBase64(fullState), sv: toBase64(sv), generation: 0 })
  assert.equal(h.sentUpdates().length, 0)

  // Unload / destroy with no unacked local edits also sends zero HTTP requests.
  h.provider.destroy()
  assert.equal(fetchCalls.length, 0)
})

test('retryable NACK merges inFlight back ahead of queued edits and retries with bounded backoff', async (t) => {
  const h = createHarness(t, { retryBaseMs: 25, retryMaxMs: 80, ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(0))

  h.doc.getText('t').insert(0, 'first-')
  assert.equal(h.sentUpdates().length, 1)
  assert.equal(h.sentUpdates()[0].seq, 1)

  // Queue another edit while seq 1 is in flight.
  h.doc.getText('t').insert(6, 'second-')
  assert.equal(h.sentUpdates().length, 1)

  // Server NACKs seq 1 as retryable.
  h.receive({ type: 'nack', seq: 1, reason: 'retryable' })
  // Another edit arrives during backoff — must coalesce into the single retry frame.
  h.doc.getText('t').insert(13, 'third')
  assert.equal(h.sentUpdates().length, 1)

  const retryFrame = await h.waitForUpdateCount(2)
  assert.equal(retryFrame.seq, 2)

  // The single retried frame carries ALL three edits (inFlight + queued + during-backoff).
  const serverDoc = new Y.Doc()
  Y.applyUpdate(serverDoc, fromBase64(retryFrame.update))
  assert.equal(serverDoc.getText('t').toString(), 'first-second-third')

  h.receive({ type: 'ack', seq: 2 })
})

test('ACK timeout requeues inFlight ahead of queued edits and retries', async (t) => {
  const h = createHarness(t, { ackTimeoutMs: 40, retryBaseMs: 20, retryMaxMs: 200 })
  h.receive(emptySyncFrame(0))

  h.doc.getText('t').insert(0, 'timed-out-')
  h.doc.getText('t').insert(10, 'plus-queued')
  assert.equal(h.sentUpdates().length, 1)

  const retryFrame = await h.waitForUpdateCount(2)
  assert.equal(retryFrame.seq, 2)
  h.receive({ type: 'ack', seq: 2 })

  const serverDoc = new Y.Doc()
  Y.applyUpdate(serverDoc, fromBase64(retryFrame.update))
  assert.equal(serverDoc.getText('t').toString(), 'timed-out-plus-queued')
})

test('disconnect requeues inFlight and reconnect handshake flushes all unacked edits', (t) => {
  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(2))

  h.doc.getText('t').insert(0, 'before-drop-')
  assert.equal(h.sentUpdates().length, 1)

  // Drop connection before ACK arrives, then make an offline edit.
  h.disconnect()
  h.doc.getText('t').insert(12, 'while-offline')
  assert.equal(h.sentUpdates().length, 1)

  // Reconnect with same generation — unacked edits flush as seq 1 sync-reply.
  h.receive(emptySyncFrame(2))
  assert.equal(h.sentUpdates().length, 2)
  assert.equal(h.sentUpdates()[1].type, 'sync-reply')
  assert.equal(h.sentUpdates()[1].seq, 1)

  const serverDoc = new Y.Doc()
  Y.applyUpdate(serverDoc, fromBase64(h.sentUpdates()[1].update))
  assert.equal(serverDoc.getText('t').toString(), 'before-drop-while-offline')

  h.receive({ type: 'ack', seq: 1 })
})

test('persistCurrentState flushes strictly unacked outbox bytes and keeps newer edits arriving mid-POST', async (t) => {
  const serverDoc = new Y.Doc()
  serverDoc.getText('t').insert(0, 'large-existing-document-'.repeat(50))
  const initialState = Y.encodeStateAsUpdate(serverDoc)
  const initialSv = Y.encodeStateVector(serverDoc)

  const fetchCalls = []
  let resolveFetch
  const originalFetch = globalThis.fetch
  globalThis.fetch = (url, init) => {
    fetchCalls.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive })
    return new Promise((resolve) => {
      resolveFetch = () => resolve({ ok: true, status: 204 })
    })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive({ type: 'sync', update: toBase64(initialState), sv: toBase64(initialSv), generation: 3 })

  // First edit is sent and ACKed — must NOT be re-encoded by persistCurrentState later.
  h.doc.getText('t').insert(0, 'acked-edit-')
  assert.equal(h.sentUpdates().length, 1)
  h.receive({ type: 'ack', seq: 1 })

  // Second edit is in flight; third edit is queued.
  h.doc.getText('t').insert(0, 'unacked-1-')
  h.doc.getText('t').insert(0, 'unacked-2-')

  h.provider.persistCurrentState()
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url, '/d/demo-slug/sync_update')
  assert.equal(fetchCalls[0].keepalive, true)
  assert.equal(fetchCalls[0].body.generation, 3)

  // Payload is strictly the unacked outbox, NOT the full initial doc or already-acked edit.
  const rawUpdateBytes = fromBase64(fetchCalls[0].body.update)
  assert.ok(
    rawUpdateBytes.byteLength < initialState.byteLength / 4,
    `expected compact outbox delta, got ${rawUpdateBytes.byteLength} bytes vs ${initialState.byteLength}`,
  )

  // Edit 4 arrives while the HTTP POST is in flight.
  h.doc.getText('t').insert(0, 'after-post-')

  // HTTP POST succeeds: unacked-1 & unacked-2 are cleared, and edit 4 flushes immediately!
  resolveFetch()
  const nextFrame = await h.waitForUpdateCount(3)

  const verifyDoc = new Y.Doc()
  Y.applyUpdate(verifyDoc, initialState)
  Y.applyUpdate(verifyDoc, fromBase64(h.sentUpdates()[0].update))
  Y.applyUpdate(verifyDoc, rawUpdateBytes)
  Y.applyUpdate(verifyDoc, fromBase64(nextFrame.update))
  assert.equal(verifyDoc.getText('t').toString(), h.doc.getText('t').toString())

  h.receive({ type: 'ack', seq: nextFrame.seq })
})

test('write-denied and stale responses clear the outbox and emit the matching event', (t) => {
  const h = createHarness(t, { ackTimeoutMs: 5000, retryBaseMs: 20 })
  const events = []
  h.provider.on('write-denied', () => events.push('write-denied'))
  h.provider.on('stale', () => events.push('stale'))

  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'denied')
  assert.equal(h.sentUpdates().length, 1)

  h.receive({ type: 'write-denied', locked: true })
  assert.deepEqual(events, ['write-denied'])

  // Stale generation on reconnect clears outbox and emits stale without flushing.
  h.doc.getText('t').insert(6, '-more')
  h.disconnect()
  h.receive(emptySyncFrame(2))
  assert.deepEqual(events, ['write-denied', 'stale'])
  assert.equal(h.sentUpdates().length, 2) // only the one edit before disconnect; nothing on stale reconnect
})

function pendingSyncFrame(extra = {}) {
  return { ...emptySyncFrame(1), seed_pending: true, ...extra }
}

function contentUpdate(text = 'body') {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, text)
  return toBase64(Y.encodeStateAsUpdate(doc))
}

function recordEvents(h) {
  const events = []
  for (const event of ['synced', 'stale', 'access-changed']) h.provider.on(event, () => events.push(event))
  return events
}

// Real time also while a test mocks the provider's timers.
const realSetTimeout = setTimeout
const pause = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms))

test('an ungranted empty handshake does not sync the editor and finishes on the first real content', (t) => {
  const h = createHarness(t)
  const events = recordEvents(h)

  h.receive(pendingSyncFrame())
  assert.equal(h.provider.synced, false)
  assert.deepEqual(events, [], 'binding here would replace the painted body with an empty editor')

  h.receive({ type: 'update', update: 'AAA=', cid: 'peer' })
  assert.deepEqual(events, [], 'an empty update is not content')

  h.receive({ type: 'update', update: contentUpdate(), cid: 'peer' })
  assert.deepEqual(events, ['synced'])
  assert.equal(h.doc.getText('t').toString(), 'body')

  h.receive({ type: 'update', update: contentUpdate('more'), cid: 'peer' })
  assert.deepEqual(events, ['synced'])
})

test('a waiting writer retries the claim until it is granted, then stops', async (t) => {
  const h = createHarness(t, { seedRetryMs: 10 })
  const events = recordEvents(h)
  const requests = () => h.sent.filter((frame) => frame.type === 'seed-request').length

  h.receive(pendingSyncFrame())
  await pause(60)
  assert.ok(requests() >= 1)
  h.receive(pendingSyncFrame())
  const before = requests()
  await pause(60)
  assert.ok(requests() > before, 'a still-pending answer re-arms the retry')

  h.receive({ ...emptySyncFrame(1), seed: true, seed_content: '# Template' })
  assert.deepEqual(events, ['synced'])
  assert.equal(h.provider.seedContent, '# Template')
  const settled = requests()
  await pause(60)
  assert.equal(requests(), settled)
})

test('a waiting writer whose access narrowed while it was offline reports it on reconnect', (t) => {
  const h = createHarness(t)
  const events = recordEvents(h)
  h.receive(pendingSyncFrame())
  h.disconnect()
  h.receive(pendingSyncFrame({ seed_content: '# Template' }))
  assert.deepEqual(events, ['access-changed'])
  assert.equal(h.provider.seedContent, null, 'the template is for a session that cannot send it')
})

test('a waiting reader whose access widened while it was offline reports it on reconnect', (t) => {
  const h = createHarness(t, { canWrite: false })
  const events = recordEvents(h)
  h.disconnect()
  h.receive(pendingSyncFrame())
  assert.deepEqual(events, ['access-changed'])
})

test('a waiting reader granted the seed hands the claim back once and reports its access', async (t) => {
  const h = createHarness(t, { canWrite: false, seedRetryMs: 10 })
  const events = recordEvents(h)
  const types = () => h.sent.map((frame) => frame.type)
  h.receive({ ...emptySyncFrame(1), seed: true, seed_content: '# Template', seed_claim: 'claim-a' })
  assert.deepEqual(events, ['access-changed'])
  assert.deepEqual(types(), ['seed-decline'])
  assert.equal(h.provider.seedContent, null)
  assert.equal(h.provider.seedClaim, null)
  await pause(60)
  h.provider.destroy()
  assert.deepEqual(types(), ['seed-decline'], 'no second decline could reach a claim taken since')
})

test('a reader that handed a claim back still goes live on content from another writer', (t) => {
  const h = createHarness(t, { canWrite: false })
  const events = recordEvents(h)
  h.receive({ ...emptySyncFrame(1), seed: true, seed_content: '# Template', seed_claim: 'claim-a' })
  h.receive({ type: 'update', update: contentUpdate(), cid: 'peer' })
  assert.deepEqual(events, ['access-changed', 'synced'])
  assert.equal(h.doc.getText('t').toString(), 'body')
})

test('a reconnect with unchanged access or with local content does not report an access change', (t) => {
  const waiting = createHarness(t)
  const holding = createHarness(t)
  const events = [recordEvents(waiting), recordEvents(holding)]
  waiting.receive(pendingSyncFrame())
  waiting.disconnect()
  waiting.receive(pendingSyncFrame())

  holding.doc.getText('t').insert(0, 'typed')
  holding.receive(pendingSyncFrame())
  holding.disconnect()
  holding.receive(pendingSyncFrame({ seed_content: '# Template' }))
  assert.deepEqual(events, [[], ['synced', 'synced']])
  assert.equal(holding.doc.getText('t').toString(), 'typed')
})

test('a waiting writer stops retrying when disconnected', async (t) => {
  const h = createHarness(t, { seedRetryMs: 10 })
  h.receive(pendingSyncFrame())
  h.disconnect()
  await pause(60)
  assert.equal(h.sent.filter((frame) => frame.type === 'seed-request').length, 0)
})

test('a writer that already holds content syncs normally on a pending handshake', (t) => {
  const h = createHarness(t)
  const events = recordEvents(h)
  h.doc.getText('t').insert(0, 'template applied from the page grant')
  h.receive(pendingSyncFrame())
  assert.deepEqual(events, ['synced'])
  assert.equal(h.sentUpdates().length, 1)
})

test('a reader shows the seed locally and reloads instead of merging real state over it', (t) => {
  const h = createHarness(t, { canWrite: false })
  const events = recordEvents(h)
  h.receive(pendingSyncFrame({ seed_content: '# Template', content_format: 'markdown' }))
  assert.deepEqual(events, ['synced'])
  assert.equal(h.provider.seedContent, '# Template')
  h.provider.seedContent = null
  h.doc.getText('t').insert(0, 'Template')

  h.disconnect()
  h.receive(pendingSyncFrame({ seed_content: '# Template' }))
  assert.equal(h.provider.seedContent, null, 'a reconnect must not offer the template again')
  h.receive({ type: 'update', update: 'AAA=', cid: 'peer' })
  assert.ok(!events.includes('stale'))

  h.receive({ type: 'update', update: contentUpdate(), cid: 'peer' })
  h.receive({ type: 'update', update: contentUpdate('typing'), cid: 'peer' })
  assert.equal(events.filter((event) => event === 'stale').length, 1, 'a typing peer must not restart the reload')
  assert.equal(events.at(-1), 'stale')
  assert.equal(h.doc.getText('t').toString(), 'Template', 'real state must not merge into the local copy')
  assert.equal(h.sentUpdates().length, 0)
})

test('a reader whose local seed was superseded while offline reloads on reconnect', (t) => {
  const h = createHarness(t, { canWrite: false })
  const events = recordEvents(h)
  h.receive(pendingSyncFrame({ seed_content: '# Template' }))
  h.doc.getText('t').insert(0, 'Template')
  h.disconnect()
  h.receive({ ...emptySyncFrame(1), update: contentUpdate() })
  assert.deepEqual(events, ['synced', 'stale'])
})

test('a late answer to a seed-request leaves the live outbox and its sequence alone', async (t) => {
  const h = createHarness(t, { ackTimeoutMs: 5000, seedRetryMs: 5 })
  h.receive(pendingSyncFrame())
  await pause(30)
  assert.ok(h.sent.some((frame) => frame.type === 'seed-request'))
  const peer = contentUpdate()
  h.receive({ type: 'update', update: peer, cid: 'peer' })

  h.doc.getText('t').insert(0, 'one ')
  h.doc.getText('t').insert(0, 'two ')
  h.receive({ ...emptySyncFrame(1), update: contentUpdate('late') })
  assert.equal(h.sentUpdates().length, 1, 'the in-flight edit must not be resent under its own number')
  assert.match(h.doc.getText('t').toString(), /late/)

  h.receive({ type: 'ack', seq: 1 })
  assert.deepEqual(h.sentUpdates().map((frame) => frame.seq), [1, 2])
  const received = new Y.Doc()
  Y.applyUpdate(received, fromBase64(peer))
  for (const frame of h.sentUpdates()) Y.applyUpdate(received, fromBase64(frame.update))
  assert.equal(received.getText('t').toString(), 'two one body')
})

test('a reader whose pending handshake already carries content shows that content, not the seed', (t) => {
  const h = createHarness(t, { canWrite: false })
  const events = recordEvents(h)
  h.receive(pendingSyncFrame({ update: contentUpdate(), seed_content: '# Template' }))
  assert.deepEqual(events, ['synced'])
  assert.equal(h.provider.seedContent, null)
})

function claimantHarness(t, options) {
  const h = createHarness(t, { ackTimeoutMs: 5000, ...options })
  h.provider.seedClaim = 'claim-a'
  h.doc.getText('t').insert(0, 'body')
  return h
}

function syncFrameFrom(doc, extra = {}) {
  return {
    type: 'sync',
    update: toBase64(Y.encodeStateAsUpdate(doc)),
    sv: toBase64(Y.encodeStateVector(doc)),
    generation: 1,
    ...extra,
  }
}

test('a channel grant hands its claim to the first seed write, and the ack ends it', (t) => {
  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive({ ...emptySyncFrame(1), seed: true, seed_content: 'body', seed_claim: 'claim-a' })
  h.doc.getText('t').insert(0, 'body')
  assert.equal(h.sentUpdates()[0].seed_claim, 'claim-a')
  h.receive({ type: 'ack', seq: 1 })
  h.doc.getText('t').insert(0, 'x')
  assert.ok(!('seed_claim' in h.sentUpdates()[1]))
})

test('a refused seed is dropped and never merged with the real state', (t) => {
  const h = claimantHarness(t)
  const events = recordEvents(h)
  h.receive(pendingSyncFrame())
  assert.equal(h.sentUpdates()[0].seed_claim, 'claim-a')

  h.receive({ type: 'update', update: contentUpdate('theirs'), cid: 'peer' })
  assert.equal(h.doc.getText('t').toString(), 'body', 'held until the claim is settled')
  h.receive({ type: 'write-denied', locked: false, stale: true })
  assert.deepEqual(events, ['synced', 'stale'])

  h.receive({ type: 'update', update: contentUpdate('theirs'), cid: 'peer' })
  h.doc.getText('t').insert(0, 'typed before the reload ')
  h.provider.persistCurrentState({ content: '', spans: [], state_vector: '' })
  assert.equal(h.doc.getText('t').toString(), 'typed before the reload body')
  assert.equal(h.sentUpdates().length, 1, 'nothing from the dropped copy may go out')
  assert.deepEqual(events, ['synced', 'stale'])
})

test('a slow claimant whose first handshake already has other content drops its seed', (t) => {
  const h = claimantHarness(t)
  const events = recordEvents(h)
  const theirs = new Y.Doc()
  theirs.getText('t').insert(0, 'theirs')
  h.receive(syncFrameFrom(theirs))
  assert.deepEqual(events, ['stale'])
  assert.equal(h.doc.getText('t').toString(), 'body')
  assert.equal(h.sentUpdates().length, 0)
})

test('a claimant whose own seed is already stored keeps it and applies held peer edits', (t) => {
  const h = claimantHarness(t)
  const events = recordEvents(h)
  h.receive(emptySyncFrame(1))
  const peer = new Y.Doc()
  Y.applyUpdate(peer, fromBase64(h.sentUpdates()[0].update))
  peer.getText('t').insert(4, ' plus')
  h.receive({ type: 'update', update: toBase64(Y.encodeStateAsUpdate(peer)), cid: 'peer' })
  assert.equal(h.doc.getText('t').toString(), 'body')
  h.receive({ type: 'ack', seq: 1 })
  assert.equal(h.doc.getText('t').toString(), 'body plus')

  const again = claimantHarness(t)
  again.receive(emptySyncFrame(1))
  const stored = new Y.Doc()
  Y.applyUpdate(stored, fromBase64(again.sentUpdates()[0].update))
  again.disconnect()
  again.receive(syncFrameFrom(stored))
  assert.equal(again.doc.getText('t').toString(), 'body')
  assert.ok(!('seed_claim' in again.sentUpdates()[1]), 'its own stored seed settles the claim')
  assert.deepEqual(events, ['synced'])
})

test('a reconnecting claimant adopts a renewed claim without taking the template twice', (t) => {
  const h = claimantHarness(t)
  h.receive({ ...emptySyncFrame(1), seed: true, seed_content: 'body', seed_claim: 'claim-b' })
  assert.equal(h.provider.seedContent, null)
  assert.equal(h.sentUpdates()[0].seed_claim, 'claim-b')
})

function refuseSeedPosts(t) {
  const originalFetch = globalThis.fetch
  const bodies = []
  const answers = []
  globalThis.fetch = (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Promise((resolve) =>
      answers.push(() => resolve({ ok: false, status: 409, json: async () => ({ seed_refused: true }) })),
    )
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  return { bodies, answer: async () => { answers.shift()(); await pause(10) } }
}

test('an HTTP seed write refused for the claim still held is dropped', async (t) => {
  const post = refuseSeedPosts(t)
  const h = claimantHarness(t)
  const events = recordEvents(h)
  h.provider.persistCurrentState()
  assert.equal(post.bodies[0].seed_claim, 'claim-a')
  h.receive(pendingSyncFrame())
  await post.answer()
  assert.deepEqual(events, ['synced', 'stale'])
})

test('a refusal for an older claim does not discard the renewed one, in either order', async (t) => {
  const renewed = { ...emptySyncFrame(1), seed: true, seed_content: 'body', seed_claim: 'claim-b' }
  const post = refuseSeedPosts(t)

  const grantFirst = claimantHarness(t)
  const grantFirstEvents = recordEvents(grantFirst)
  grantFirst.provider.persistCurrentState()
  grantFirst.receive(renewed)
  await post.answer()
  assert.deepEqual(grantFirstEvents, ['synced'])

  const refusalFirst = claimantHarness(t)
  const refusalFirstEvents = recordEvents(refusalFirst)
  refusalFirst.provider.persistCurrentState()
  await post.answer()
  assert.deepEqual(refusalFirstEvents, [], 'the handshake decides')
  refusalFirst.receive(renewed)
  assert.deepEqual(refusalFirstEvents, ['synced'])
  assert.equal(refusalFirst.sentUpdates()[0].seed_claim, 'claim-b')
})

test('an accepted HTTP seed write settles the claim', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve({ ok: true, status: 204 })
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const h = claimantHarness(t)
  h.provider.persistCurrentState()
  await pause(10)
  assert.equal(h.provider.seedClaim, null)
})

// A half-open socket: ActionCable reopens it without `disconnected`, so the
// next handshake arrives while the provider still counts as synced.
test('a second handshake without a disconnect makes a reader with a local seed reload, not merge', (t) => {
  for (const extra of [{}, { seed_pending: true }]) {
    const h = createHarness(t, { canWrite: false })
    const events = recordEvents(h)
    h.receive(pendingSyncFrame({ seed_content: 'hello' }))
    h.doc.getText('t').insert(0, 'hello')
    const real = new Y.Doc()
    real.getText('t').insert(0, 'hello')
    h.receive(syncFrameFrom(real, extra))
    assert.equal(h.doc.getText('t').toString(), 'hello')
    assert.equal(events.at(-1), 'stale')
  }
})

test('a second handshake without a disconnect renews the claim of unsaved seed edits', (t) => {
  const h = claimantHarness(t)
  h.receive(pendingSyncFrame())
  h.doc.getText('t').insert(4, ' edited')
  h.receive({ ...emptySyncFrame(1), seed: true, seed_content: 'body', seed_claim: 'claim-b' })
  assert.equal(h.provider.seedClaim, 'claim-b')
  assert.equal(h.provider.seedContent, null)
  assert.ok(!h.sent.some((frame) => frame.type === 'seed-decline'))

  const resent = h.sentUpdates()[1]
  assert.equal(resent.seed_claim, 'claim-b')
  const stored = new Y.Doc()
  Y.applyUpdate(stored, fromBase64(resent.update))
  assert.equal(stored.getText('t').toString(), 'body edited')
})

test('a second handshake without a disconnect resends unacked edits under a new number', (t) => {
  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'one ')
  h.doc.getText('t').insert(4, 'two')
  h.receive(emptySyncFrame(1))
  assert.deepEqual(h.sentUpdates().map((frame) => frame.seq), [1, 2])

  h.receive({ type: 'ack', seq: 1 })
  h.disconnect()
  h.receive(emptySyncFrame(1))
  const last = new Y.Doc()
  Y.applyUpdate(last, fromBase64(h.sentUpdates().at(-1).update))
  assert.equal(last.getText('t').toString(), 'one two', 'an ack of the first send must not settle the second')
})

test('a late grant to a claimant with unsaved seed edits is adopted, and to a synced one is declined', async (t) => {
  const grant = { ...emptySyncFrame(1), seed: true, seed_content: 'body', seed_claim: 'claim-b' }
  const waiting = async () => {
    const h = createHarness(t, { seedRetryMs: 5, ackTimeoutMs: 5000 })
    h.receive(pendingSyncFrame())
    await pause(30)
    assert.ok(h.sent.some((frame) => frame.type === 'seed-request'))
    h.receive({ type: 'update', update: contentUpdate(), cid: 'peer' })
    return h
  }
  const declined = await waiting()
  declined.receive(grant)
  assert.equal(declined.provider.seedClaim, null)
  assert.equal(declined.sent.at(-1).type, 'seed-decline')

  const adopted = await waiting()
  adopted.provider.seedClaim = 'claim-a'
  adopted.receive(grant)
  assert.equal(adopted.provider.seedClaim, 'claim-b')
  assert.ok(!adopted.sent.some((frame) => frame.type === 'seed-decline'))
})

test('a grant that arrives with stored content is handed back, so peers show and edits are not refused', (t) => {
  const stored = new Y.Doc()
  stored.getText('t').insert(0, 'theirs')
  const grant = { seed: true, seed_content: 'body', seed_claim: 'claim-b' }
  const openings = {
    'content in the handshake': (h) => h.receive(syncFrameFrom(stored, grant)),
    'content broadcast just before an empty handshake': (h) => {
      h.receive({ type: 'update', update: toBase64(Y.encodeStateAsUpdate(stored)), cid: 'peer' })
      h.receive({ ...emptySyncFrame(1), ...grant })
    },
  }
  for (const [name, open] of Object.entries(openings)) {
    const h = createHarness(t, { ackTimeoutMs: 5000 })
    open(h)
    assert.equal(h.provider.seedClaim, null, name)
    assert.equal(h.provider.seedContent, null, name)
    assert.ok(h.sent.some((frame) => frame.type === 'seed-decline'), name)

    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(stored))
    peer.getText('t').insert(6, ' and mine')
    h.receive({ type: 'update', update: toBase64(Y.encodeStateAsUpdate(peer)), cid: 'peer' })
    assert.equal(h.doc.getText('t').toString(), 'theirs and mine', name)

    h.doc.getText('t').insert(0, 'my ')
    assert.ok(!('seed_claim' in h.sentUpdates().at(-1)), name)
  }
})

test('a re-grant that also shows the own seed is stored does not bring the claim back', (t) => {
  const h = claimantHarness(t)
  h.receive(emptySyncFrame(1))
  const stored = new Y.Doc()
  Y.applyUpdate(stored, fromBase64(h.sentUpdates()[0].update))
  h.disconnect()
  h.receive(syncFrameFrom(stored, { seed: true, seed_content: 'body', seed_claim: 'claim-b' }))
  assert.equal(h.provider.seedClaim, null)
  assert.ok(h.sent.some((frame) => frame.type === 'seed-decline'))
  assert.equal(h.doc.getText('t').toString(), 'body')
})

test('a replaced document makes a claimant hand back a new grant and drop its edits', (t) => {
  const h = claimantHarness(t)
  const events = recordEvents(h)
  h.receive(pendingSyncFrame())
  h.disconnect()
  h.receive({ ...emptySyncFrame(2), seed: true, seed_content: 'new', seed_claim: 'claim-b' })
  assert.deepEqual(events, ['synced', 'stale'])
  assert.equal(h.sent.at(-1).type, 'seed-decline')
  assert.equal(h.sentUpdates().length, 1)
})

test('an ordinary 409 does not discard a claimant', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'stale' }) })
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const h = claimantHarness(t)
  const events = recordEvents(h)
  h.receive(pendingSyncFrame())
  h.provider.persistCurrentState()
  await pause(10)
  assert.deepEqual(events, ['synced'])
  assert.equal(h.provider.seedClaim, 'claim-a')
})

test('a sync_update refused after access was revoked keeps the unsent edits', async (t) => {
  const originalFetch = globalThis.fetch
  // The server's answer to a refused write: 423 to a client asking for JSON,
  // otherwise a redirect that fetch follows to an ordinary page.
  globalThis.fetch = async (_url, init) =>
    new Headers(init.headers).get('Accept') === 'application/json'
      ? { ok: false, status: 423, redirected: false }
      : { ok: true, status: 200, redirected: true }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'in flight')
  h.doc.getText('t').insert(0, 'queued ')
  h.provider.persistCurrentState()
  await pause(10)

  assert.ok(h.provider.inFlight, 'the refused update must not count as stored')
  assert.equal(h.provider.queued.length, 1, 'the refused queued edit must not count as stored')
})

const KEEPALIVE_LIMIT = 64 * 1024

// Browsers refuse a keepalive request that takes the total of those in flight
// past 64 KiB. Ordinary requests have no such limit.
function stubLimitedFetch(t) {
  const calls = []
  let inFlight = 0
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  globalThis.fetch = (_url, init) => {
    const bytes = new TextEncoder().encode(init.body).byteLength
    const call = { bytes, keepalive: init.keepalive === true, body: JSON.parse(init.body), signal: init.signal, refused: false }
    calls.push(call)
    if (call.keepalive && inFlight + bytes > KEEPALIVE_LIMIT) {
      call.refused = true
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    if (call.keepalive) inFlight += bytes
    return new Promise((resolve, reject) => {
      const settle = (done) => {
        if (call.keepalive) inFlight -= bytes
        done()
        return pause(0)
      }
      call.respond = (status = 204, json = null) =>
        settle(() => resolve({ ok: status < 400, status, json: async () => json }))
      call.fail = () => settle(() => reject(new TypeError('Failed to fetch')))
    })
  }
  // Settle what a test left pending, so it holds no room in the next one.
  t.after(async () => {
    for (const call of calls) await call.respond?.()
    globalThis.fetch = originalFetch
    console.warn = originalWarn
  })
  return { calls, warnings }
}

function editedHarness(t, characters) {
  const h = createHarness(t, { initialGeneration: 1 })
  h.doc.getText('t').insert(0, 'x'.repeat(characters))
  return h
}

function savedText(call) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, fromBase64(call.body.update))
  return doc.getText('t').toString()
}

function savedByAll(calls) {
  const doc = new Y.Doc()
  for (const call of calls) Y.applyUpdate(doc, fromBase64(call.body.update))
  return doc.getText('t').toString()
}

const snapshotOf = (characters) => ({ content: 'y'.repeat(characters), spans: [], state_vector: 'AA==' })

test('a save too large for keepalive goes out as an ordinary request and settles the outbox', async (t) => {
  const { calls, warnings } = stubLimitedFetch(t)
  const h = editedHarness(t, 100_000)

  h.provider.persistCurrentState(snapshotOf(100_000))
  assert.equal(calls[0].refused, false)
  assert.equal(calls[0].keepalive, false)
  assert.equal(savedText(calls[0]).length, 100_000)

  await calls[0].respond()
  assert.deepEqual(warnings, [])
  h.receive(emptySyncFrame(1))
  assert.equal(h.sentUpdates().length, 0, 'the saved edit is not owed again')
})

test('a save that fits alone is an ordinary request while another keepalive save holds the room', async (t) => {
  const { calls, warnings } = stubLimitedFetch(t)
  const h = editedHarness(t, 30_000)

  h.provider.persistCurrentState()
  h.doc.getText('t').insert(0, 'later ')
  h.provider.persistCurrentState()
  assert.deepEqual(calls.map((call) => [call.keepalive, call.refused]), [[true, false], [false, false]])

  await calls[0].respond()
  await calls[1].respond()
  h.provider.persistCurrentState(snapshotOf(10))
  assert.equal(calls[2].keepalive, true, 'a settled save gives its room back')
  assert.deepEqual(warnings, [])
})

test('a failed or refused keepalive save gives its room back and keeps the edit owed', async (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = editedHarness(t, 30_000)

  h.provider.persistCurrentState()
  await calls[0].fail()
  h.provider.persistCurrentState()
  assert.equal(calls[1].keepalive, true)
  await calls[1].respond(423)
  h.provider.persistCurrentState()
  assert.equal(calls[2].keepalive, true)
  assert.equal(savedText(calls[2]).length, 30_000)
})

test('a snapshot that no longer fits is left to its debounce so the edit keeps its keepalive', (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = editedHarness(t, 30)

  h.provider.persistCurrentState(snapshotOf(40_000))
  h.provider.persistCurrentState(snapshotOf(40_000))
  assert.equal(calls[0].body.content.length, 40_000)
  assert.deepEqual(calls.map((call) => [call.keepalive, call.refused]), [[true, false], [true, false]])
  assert.equal(calls[1].body.content, undefined)
  assert.equal(savedText(calls[1]).length, 30)
})

test('providers on one page share the keepalive room', (t) => {
  const { calls } = stubLimitedFetch(t)
  editedHarness(t, 30_000).provider.persistCurrentState()
  editedHarness(t, 30_000).provider.persistCurrentState()
  assert.deepEqual(calls.map((call) => [call.keepalive, call.refused]), [[true, false], [false, false]])
})

test('a large unsaved edit is still sent when its provider is destroyed', (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = editedHarness(t, 100_000)
  h.provider.destroy()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].refused, false)
  assert.equal(savedText(calls[0]).length, 100_000)
})

test('a large save settles what it carried and leaves only what was typed while it was away', async (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = editedHarness(t, 100_000)
  h.provider.persistCurrentState()
  for (const letter of 'later ') h.doc.getText('t').insert(0, letter)
  await calls[0].respond()

  h.provider.destroy()
  assert.equal(calls.length, 2)
  assert.ok(calls[1].bytes < 1_000, `${calls[1].bytes} bytes`)
  assert.equal(calls[1].keepalive, true)
  assert.equal(savedByAll(calls), h.doc.getText('t').toString())
})

test('a deletion made while a large save is away is still owed after it', async (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = editedHarness(t, 100_000)
  h.provider.persistCurrentState()
  h.doc.getText('t').delete(10, 500)
  await calls[0].respond()

  h.provider.persistCurrentState()
  assert.ok(calls[1].bytes < 1_000, `${calls[1].bytes} bytes`)
  assert.equal(savedByAll(calls).length, 99_500)
})

test('overlapping saves each settle only what they carried, whichever answers first', async (t) => {
  for (const [first, second, owed] of [[204, 423, ['b']], [423, 204, []], [204, 204, []], [423, 423, ['a', 'b']]]) {
    for (const order of [[0, 1], [1, 0]]) {
      const { calls } = stubLimitedFetch(t)
      const h = createHarness(t, { initialGeneration: 1 })
      h.doc.getText('a').insert(0, 'first')
      h.provider.persistCurrentState()
      h.doc.getText('b').insert(0, 'second')
      h.provider.persistCurrentState()
      h.doc.getText('c').insert(0, 'third')
      for (const call of order) await calls[call].respond([first, second][call])

      h.receive(emptySyncFrame(1))
      const sent = Y.decodeUpdate(fromBase64(h.sentUpdates()[0].update))
      const owedNames = sent.structs.filter((struct) => struct.parent).map((struct) => struct.parent)
      assert.deepEqual(owedNames, [...owed, 'c'], `${first}/${second} answered ${order}`)
    }
  }
})

test('a save settles what it carried after that moved into a socket frame with later edits', async (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = editedHarness(t, 100_000)
  h.provider.persistCurrentState()
  h.doc.getText('t').insert(0, 'later ')
  h.receive(emptySyncFrame(1))
  assert.equal(h.sentUpdates().length, 1)
  await calls[0].respond()
  assert.equal(h.sentUpdates().length, 1, 'the later edit still waits for its own receipt')

  h.disconnect()
  h.receive(emptySyncFrame(1))
  assert.ok(h.sentUpdates()[1].update.length < 1_000)
  const server = new Y.Doc()
  Y.applyUpdate(server, fromBase64(calls[0].body.update))
  Y.applyUpdate(server, fromBase64(h.sentUpdates()[1].update))
  assert.equal(server.getText('t').toString(), h.doc.getText('t').toString())
})

test('an edit typed during a save that was refused goes out with everything still owed', async (t) => {
  for (const status of [409, 423]) {
    const { calls } = stubLimitedFetch(t)
    const h = editedHarness(t, 100_000)
    h.provider.persistCurrentState()
    h.doc.getText('t').insert(0, 'later ')
    await calls[0].respond(status)
    h.provider.persistCurrentState()
    assert.equal(savedText(calls[1]), h.doc.getText('t').toString())
  }
})

const MAX_UPDATE = 2 * 1024 * 1024

const LARGE = '漢'.repeat(800_000)

// The provider's clock moves only when the test says so.
function mockClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return (ms) => t.mock.timers.tick(ms)
}

function applySave(call, server) {
  const updates = call.body.updates ?? [call.body.update]
  for (const update of updates) {
    assert.ok(fromBase64(update).length <= MAX_UPDATE)
    Y.applyUpdate(server, fromBase64(update))
  }
}

test('an edit larger than one frame is saved whole in one request, between what came before and after', async (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t)
  const server = new Y.Doc()
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'before ')
  h.doc.getText('t').insert(7, LARGE)
  h.doc.getText('t').insert(0, 'after ')
  Y.applyUpdate(server, fromBase64(h.sentUpdates()[0].update))
  h.receive({ type: 'ack', seq: 1 })
  assert.equal(h.sentUpdates().length, 1, 'no frame carries the large edit')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].body.updates.length > 1)
  assert.equal(calls[0].body.generation, 1)
  applySave(calls[0], server)
  await calls[0].respond()
  Y.applyUpdate(server, fromBase64(h.sentUpdates()[1].update))
  h.receive({ type: 'ack', seq: h.sentUpdates()[1].seq })
  assert.equal(server.getText('t').toString(), h.doc.getText('t').toString())
  assert.equal(h.provider.unackedParts().length, 0)
})

test('a large edit is retried after a failed request and after a lost connection', async (t) => {
  const tick = mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { retryBaseMs: 5 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, LARGE)
  await calls[0].fail()
  tick(4)
  assert.equal(calls.length, 1)
  tick(1)
  assert.equal(calls.length, 2)
  h.disconnect()
  assert.equal(calls[1].signal.aborted, true, 'nothing else would end a request on a lost connection')
  await calls[1].fail()
  h.receive(emptySyncFrame(1))
  assert.equal(calls.length, 3)
  await calls[2].respond()
  assert.equal(h.provider.unackedParts().length, 0)
})

const statesOf = (h) => {
  const states = []
  h.provider.on('save-state', () => states.push(h.provider.saveState))
  return states
}

test('a large edit the server refuses is stuck, kept, and not sent again on this connection', async (t) => {
  const tick = mockClock(t)
  for (const status of [413, 422, 403, 423]) {
    const { calls } = stubLimitedFetch(t)
    const h = createHarness(t, { retryBaseMs: 5 })
    const states = statesOf(h)
    h.receive(emptySyncFrame(1))
    h.doc.getText('t').insert(0, LARGE)
    await calls[0].respond(status)
    h.doc.getText('t').insert(0, 'later ')
    h.provider.persistCurrentState()
    tick(20_000)
    assert.equal(calls.length, 1)
    assert.equal(h.sentUpdates().length, 0)
    assert.deepEqual(states, ['sending', 'stuck'], 'said once, not on every edit')
    assert.ok(h.provider.unackedParts().length > 0)

    h.disconnect()
    assert.equal(h.provider.saveState, 'stuck', 'still unsaved while offline')
    h.receive(emptySyncFrame(1))
    assert.equal(calls.length, 2)
    await calls[1].respond()
    assert.equal(h.provider.saveState, null)
    assert.equal(h.sentUpdates().length, 1, 'what was typed after it follows')
  }
})

test('a refusal ends when another save stores its edit', async (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t)
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, LARGE)
  h.provider.persistCurrentState()
  await calls[0].respond(413)
  assert.equal(h.provider.saveState, 'stuck')
  await calls[1].respond()
  assert.equal(h.provider.saveState, null)
  h.doc.getText('t').insert(0, 'later ')
  assert.equal(h.sentUpdates().length, 1)
})

test('a refusal does not outlive its edit: a later large edit that only fails is still retried', async (t) => {
  const tick = mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { retryBaseMs: 2_000, retryMaxMs: 2_000, uploadWarnMs: 1_000 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, LARGE)
  h.provider.persistCurrentState()
  await calls[0].respond(413)
  await calls[1].respond()
  h.doc.getText('t').insert(0, LARGE)
  assert.equal(calls.length, 3)
  await calls[2].respond(503)
  tick(1_000)
  assert.equal(h.provider.saveState, 'stuck')
  assert.equal(calls.length, 3)
  tick(1_000)
  assert.equal(calls.length, 4, 'nothing refused this one')
  await calls[3].respond()
  assert.equal(h.provider.saveState, null)
})

test('each large edit has its own time before it is called unsaved', async (t) => {
  const tick = mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { uploadWarnMs: 30_000 })
  h.receive(emptySyncFrame(1))
  const states = statesOf(h)
  h.doc.getText('t').insert(0, LARGE)
  tick(20_000)
  h.doc.getText('t').insert(0, LARGE)
  tick(5_000)
  await calls[0].respond()
  assert.equal(calls.length, 2)
  tick(24_999)
  assert.deepEqual(states, ['sending'], 'the first edit takes its time with it')
  tick(1)
  assert.deepEqual(states, ['sending', 'stuck'], 'and does not delay the second')
})

test('a large edit that cannot even be sent is called unsaved, and no longer once it is stored', async (t) => {
  const tick = mockClock(t)
  const situations = {
    'before the first handshake': () => {},
    offline: (h) => { h.receive(emptySyncFrame(1)); h.disconnect() },
    'behind an unanswered frame': (h) => { h.receive(emptySyncFrame(1)); h.doc.getText('t').insert(0, 'small') },
    'in a request without an answer': (h) => h.receive(emptySyncFrame(1)),
  }
  for (const [name, arrange] of Object.entries(situations)) {
    const { calls } = stubLimitedFetch(t)
    const h = createHarness(t, { uploadWarnMs: 1_000, ackTimeoutMs: 5_000 })
    arrange(h)
    h.doc.getText('t').insert(0, LARGE)
    assert.equal(h.provider.saveState, 'sending', name)
    tick(999)
    assert.equal(h.provider.saveState, 'sending', name)
    tick(1)
    assert.equal(h.provider.saveState, 'stuck', name)
    if (name.startsWith('behind')) h.receive({ type: 'ack', seq: 1 })
    else if (calls.length === 0) h.receive(emptySyncFrame(1))
    await calls[0].respond()
    assert.equal(h.provider.saveState, null, name)
  }
})

test('a connection that replaces a half-open one tries a refused edit again', async (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t)
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, LARGE)
  await calls[0].respond(413)
  h.receive(emptySyncFrame(1))
  assert.equal(calls.length, 2)
  await calls[1].respond()
  assert.equal(h.provider.saveState, null)
})

test('a refusal that was read only after the connection dropped does not count for the next one', async (t) => {
  const tick = mockClock(t)
  for (const reconnect of ['before', 'after']) {
    const { calls } = stubLimitedFetch(t)
    const h = createHarness(t, { retryBaseMs: 5 })
    h.receive(emptySyncFrame(1))
    h.doc.getText('t').insert(0, LARGE)
    const answered = calls[0].respond(413)
    h.disconnect()
    if (reconnect === 'before') h.receive(emptySyncFrame(1))
    await answered
    if (reconnect === 'after') h.receive(emptySyncFrame(1))
    tick(5)
    assert.equal(calls.length, 2, `handshake ${reconnect} the answer was read`)
    await calls[1].respond(413)
    tick(20_000)
    assert.equal(calls.length, 2, 'refused on this connection')
    assert.equal(h.provider.saveState, 'stuck')
  }
})

test('a large seed refused for a claim since renewed is sent again under the new one', async (t) => {
  const tick = mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { retryBaseMs: 5 })
  const events = recordEvents(h)
  const grant = (claim) => ({ ...emptySyncFrame(1), seed: true, seed_claim: claim, seed_content: '# Seed' })
  h.receive(grant('claim-a'))
  h.doc.getText('t').insert(0, LARGE)
  h.receive(grant('claim-b'))
  await calls[0].respond(409, { seed_refused: true })
  tick(5)
  assert.equal(events.includes('stale'), false)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].body.seed_claim, 'claim-b')
  assert.ok(h.provider.unackedParts().length > 0)
})

test('a large edit refused as stale or locked recovers the way a frame does', async (t) => {
  mockClock(t)
  for (const [status, event, state] of [[409, 'stale', null], [423, 'write-denied', 'stuck']]) {
    const { calls } = stubLimitedFetch(t)
    const h = createHarness(t)
    const events = []
    for (const name of ['stale', 'write-denied']) h.provider.on(name, () => events.push([name, h.provider.saveState]))
    h.receive(emptySyncFrame(1))
    h.doc.getText('t').insert(0, LARGE)
    await calls[0].respond(status)
    assert.deepEqual(events, [[event, state]], 'stuck is known before access is reloaded')
    assert.equal(h.provider.unackedParts().length > 0, state !== null)
  }
})

test('a frame refused as locked keeps the large edit queued behind it, and one refused as stale does not', (t) => {
  stubLimitedFetch(t)
  for (const stale of [false, true]) {
    const h = createHarness(t)
    const events = []
    for (const name of ['stale', 'write-denied']) h.provider.on(name, () => events.push(name))
    h.receive(emptySyncFrame(1))
    h.doc.getText('t').insert(0, 'small')
    h.doc.getText('t').insert(0, LARGE)
    h.receive({ type: 'write-denied', locked: !stale, stale })
    assert.deepEqual(events, [stale ? 'stale' : 'write-denied'])
    assert.equal(h.provider.saveState, stale ? null : 'stuck')
    const kept = new Y.Doc()
    for (const part of h.provider.unackedParts()) Y.applyUpdate(kept, part)
    assert.equal(kept.getText('t').toString(), stale ? '' : h.doc.getText('t').toString())
  }
})

test('5xx, 408, 429 and lost answers are retried with backoff, one request at a time', async (t) => {
  const tick = mockClock(t)
  for (const status of [500, 503, 408, 429, 0]) {
    const { calls } = stubLimitedFetch(t)
    const h = createHarness(t, { retryBaseMs: 10, retryMaxMs: 20 })
    h.receive(emptySyncFrame(1))
    h.doc.getText('t').insert(0, LARGE)
    for (let i = 0; i < 4; i += 1) {
      assert.equal(h.provider.saveState, 'sending', 'a failure that is retried is not a refusal')
      const answered = calls.length
      await (status ? calls[answered - 1].respond(status) : calls[answered - 1].fail())
      tick(i === 0 ? 9 : 19)
      assert.equal(calls.length, answered, 'not before its backoff')
      tick(1)
      assert.equal(calls.length, answered + 1, 'one request at a time')
    }
    await calls.at(-1).respond()
    assert.equal(h.provider.saveState, null)
    assert.equal(h.provider.unackedParts().length, 0)
  }
})

test('a request that never answers is given up at its deadline and sent again', async (t) => {
  const tick = mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const deadlines = []
  const h = createHarness(t, {
    retryBaseMs: 5,
    uploadDeadlineMs: (bytes) => { deadlines.push(bytes); return 20 },
  })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, LARGE)
  tick(19)
  assert.equal(calls[0].signal.aborted, false)
  tick(1)
  assert.equal(calls[0].signal.aborted, true)
  await calls[0].fail()
  tick(5)
  assert.equal(calls.length, 2)
  assert.ok(deadlines[0] > MAX_UPDATE)
  await calls[1].respond()
  tick(20_000)
  assert.equal(calls[1].signal.aborted, false, 'an answered request keeps no deadline')
})

test('a second handshake during an upload does not send it twice', async (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t)
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, LARGE)
  h.receive(emptySyncFrame(1))
  assert.equal(calls.length, 1)
  await calls[0].respond()
  h.doc.getText('t').insert(0, 'later ')
  assert.equal(h.sentUpdates().length, 1)
})

test('a save withholds an edit that cannot be split and everything after it', async (t) => {
  const tick = mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t)
  const states = statesOf(h)
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'small')
  h.doc.getMap('m').set('value', 'x'.repeat(MAX_UPDATE + 1))
  h.doc.getText('t').insert(0, 'later ')
  h.provider.persistCurrentState(snapshotOf(10))
  assert.equal(calls.length, 1)
  assert.equal(savedText(calls[0]), 'small')
  assert.equal(calls[0].body.content, undefined, 'no source is saved ahead of the edits it shows')
  await calls[0].respond()
  h.provider.persistCurrentState(snapshotOf(10))
  tick(20_000)
  await pause(0)
  assert.equal(calls.length, 1)
  assert.equal(h.sentUpdates().length, 1)
  assert.deepEqual(states.at(-1), 'stuck')
  assert.ok(h.provider.unackedParts().length > 0)
})

test('medium edits are sent in frames that fit', (t) => {
  const h = createHarness(t)
  h.receive(emptySyncFrame(1))
  for (let i = 0; i < 4; i += 1) h.doc.getText('t').insert(0, 'x'.repeat(900_000))
  const server = new Y.Doc()
  for (let i = 0; i < h.sentUpdates().length; i += 1) {
    const frame = h.sentUpdates()[i]
    assert.ok(fromBase64(frame.update).length <= MAX_UPDATE)
    Y.applyUpdate(server, fromBase64(frame.update))
    h.receive({ type: 'ack', seq: frame.seq })
  }
  assert.equal(server.getText('t').length, 3_600_000)
  assert.equal(h.provider.saveState, null)
})

test('small edits beside a large one do not count towards the pieces of a save', (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { initialGeneration: 1 })
  h.doc.getText('t').insert(0, LARGE)
  for (let i = 0; i < 12; i += 1) {
    h.provider.persistCurrentState()
    h.doc.getText('t').insert(0, `edit ${i} `)
  }
  h.provider.persistCurrentState()
  assert.ok(h.provider.unackedParts().length > 8)
  assert.ok(calls.at(-1).body.updates.length <= 4, `${calls.at(-1).body.updates.length} pieces`)
  const server = new Y.Doc()
  applySave(calls.at(-1), server)
  assert.equal(server.getText('t').toString(), h.doc.getText('t').toString())
})

test('lost access reloads a waiting page, or is held for an unsaved large edit, never both', async (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const lostAccess = () => pendingSyncFrame({ seed_content: '# Template' })

  const waiting = createHarness(t)
  const waitingEvents = recordEvents(waiting)
  waiting.receive(pendingSyncFrame())
  waiting.disconnect()
  waiting.receive(lostAccess())
  assert.deepEqual(waitingEvents, ['access-changed'])
  assert.equal(waiting.provider.saveState, null, 'nothing keeps this page from its current access')

  const holding = createHarness(t)
  const holdingEvents = recordEvents(holding)
  holding.receive(emptySyncFrame(1))
  holding.doc.getText('t').insert(0, LARGE)
  holding.disconnect()
  await calls[0].fail()
  const denied = []
  holding.provider.on('write-denied', () => denied.push(holding.provider.saveState))
  holding.receive(lostAccess())
  await calls[1].respond(423)
  assert.equal(holdingEvents.includes('access-changed'), false)
  assert.deepEqual(denied, ['stuck'])
  assert.ok(holding.provider.unackedParts().length > 0)
})

test('a waiting page goes live on a split edit as a whole', (t) => {
  const h = createHarness(t)
  const events = recordEvents(h)
  h.receive(pendingSyncFrame())
  const writer = new Y.Doc()
  writer.getText('t').insert(0, LARGE)
  const updates = splitUpdate(Y.encodeStateAsUpdate(writer), MAX_UPDATE).map(toBase64)
  h.receive({ type: 'update', updates, cid: 'peer' })
  assert.deepEqual(events, ['synced'])
  assert.equal(h.doc.getText('t').length, LARGE.length)
})

test('a peer applies the pieces of a split edit together', (t) => {
  const h = createHarness(t)
  h.receive(emptySyncFrame(1))
  const writer = new Y.Doc()
  writer.getText('t').insert(0, LARGE)
  const seen = []
  h.doc.on('update', () => seen.push(h.doc.getText('t').length))
  const updates = splitUpdate(Y.encodeStateAsUpdate(writer), MAX_UPDATE).map(toBase64)
  h.receive({ type: 'update', updates, cid: 'peer' })
  assert.deepEqual(seen, [LARGE.length])
})

test('a seed larger than one frame is saved whole with its claim', async (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t)
  h.receive({ ...emptySyncFrame(1), seed: true, seed_claim: 'claim-a', seed_content: '# Seed' })
  h.doc.getText('t').insert(0, LARGE)
  assert.equal(calls[0].body.seed_claim, 'claim-a')
  await calls[0].respond()
  assert.equal(h.provider.seedClaim, null)
  assert.equal(h.provider.unackedParts().length, 0)
})

test('leaving the page asks first while a large edit is unsaved', async (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t)
  h.receive(emptySyncFrame(1))
  const leave = () => {
    let asked = false
    h.provider.handleUnload({ preventDefault: () => { asked = true } })
    return asked
  }
  h.doc.getText('t').insert(0, LARGE)
  assert.equal(leave(), true)
  assert.ok(h.provider.awareness.getLocalState(), 'someone who stays is still present')
  for (const call of calls) await call.respond()
  h.doc.getText('t').insert(0, 'small')
  assert.equal(leave(), false)
})

test('a large edit left when its provider is destroyed is saved', (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = editedHarness(t, 10)
  h.doc.getText('t').insert(0, LARGE)
  h.provider.destroy()
  const server = new Y.Doc()
  applySave(calls[0], server)
  assert.equal(server.getText('t').toString(), h.doc.getText('t').toString())
})

test('splitting keeps surrogate pairs, deletions and structure', () => {
  const doc = new Y.Doc()
  const updates = []
  doc.getText('t').insert(0, 'old text to replace')
  const base = Y.encodeStateAsUpdate(doc)
  doc.on('update', (update) => updates.push(update))
  doc.transact(() => {
    doc.getText('t').delete(0, 8)
    doc.getText('t').insert(0, 'a' + '😀'.repeat(2_000))
    for (let i = 0; i < 200; i += 1) doc.getText('t').insert(5, `run ${i}`, { bold: { by: i } })
  })
  for (const limit of [300, 301, 302, 1_000]) {
    const pieces = splitUpdate(updates[0], limit)
    assert.ok(pieces.every((piece) => piece.length <= limit))
    const copy = new Y.Doc()
    Y.applyUpdate(copy, base)
    pieces.reverse().forEach((piece, i) => {
      assert.equal(copy.getText('t').toString(), 'old text to replace', `piece ${i} of ${pieces.length}`)
      Y.applyUpdate(copy, piece)
    })
    assert.deepEqual(copy.getText('t').toDelta(), doc.getText('t').toDelta())
  }
})

test('the largest 3-byte text the document size guard allows is saved in one split request', async (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t)
  const server = new Y.Doc()
  h.receive(emptySyncFrame(1))
  // MAX_DOCUMENT_SIZE = 2 MiB UTF-16 units; 1 paragraph boundary = 2 units.
  const maxChars = 2 * 1024 * 1024 - 2
  h.doc.transact(() => {
    const p = new Y.XmlElement('paragraph')
    const txt = new Y.XmlText()
    txt.insert(0, '漢'.repeat(maxChars), {
      provenance: { kind: 'human', author: 'Test Author', state: 'verbatim' },
    })
    p.insert(0, [txt])
    h.doc.getXmlFragment('prosemirror').insert(0, [p])
  })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].body.updates.length <= 5, `${calls[0].body.updates.length} pieces`)
  const totalBytes = calls[0].body.updates.reduce((sum, u) => sum + fromBase64(u).length, 0)
  assert.ok(totalBytes <= 7 * 1024 * 1024, `${totalBytes} bytes`)
  applySave(calls[0], server)
  await calls[0].respond()
  assert.equal(h.provider.saveState, null)
  assert.equal(h.provider.unackedParts().length, 0)
})

test('an edit beyond the total or piece limit is called stuck immediately, never sent, and leaving asks', (t) => {
  mockClock(t)
  const { calls } = stubLimitedFetch(t)

  // Over total limit (> 7 MiB)
  const overBytes = createHarness(t)
  overBytes.receive(emptySyncFrame(1))
  overBytes.doc.getText('t').insert(0, '漢'.repeat(2_500_000))
  assert.equal(overBytes.provider.saveState, 'stuck')
  assert.equal(calls.length, 0)
  assert.equal(overBytes.sentUpdates().length, 0)
  let asked = false
  overBytes.provider.handleUnload({ preventDefault: () => { asked = true } })
  assert.equal(asked, true)
  assert.equal(calls.length, 0)

  // Over piece limit (> 5 pieces while total bytes <= 7 MiB: 6 paragraphs of ~1.05 MiB each)
  const overPieces = createHarness(t)
  overPieces.receive(emptySyncFrame(1))
  overPieces.doc.transact(() => {
    const els = []
    for (let i = 0; i < 6; i += 1) {
      const p = new Y.XmlElement('paragraph')
      const txt = new Y.XmlText()
      txt.insert(0, '漢'.repeat(350_000))
      p.insert(0, [txt])
      els.push(p)
    }
    overPieces.doc.getXmlFragment('prosemirror').insert(0, els)
  })
  assert.equal(overPieces.provider.saveState, 'stuck')
  assert.equal(calls.length, 0)
  assert.equal(overPieces.sentUpdates().length, 0)
})

test('two large edits beyond one save on leaving send the first edit within the limit', (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { initialGeneration: 1 })
  // Two separate 4.2 MiB edits: each fits in one save, together (8.4 MiB) they exceed 7 MiB.
  const fourMb = '漢'.repeat(1_400_000)
  h.doc.getText('a').insert(0, fourMb)
  h.doc.getText('b').insert(0, fourMb)
  h.provider.destroy()
  assert.equal(calls.length, 1)
  const updates = calls[0].body.updates
  assert.ok(updates.length <= 5, `${updates.length} pieces`)
  const totalBytes = updates.reduce((sum, u) => sum + fromBase64(u).length, 0)
  assert.ok(totalBytes <= 7 * 1024 * 1024, `${totalBytes} bytes`)
  const server = new Y.Doc()
  applySave(calls[0], server)
  assert.equal(server.getText('a').length, fourMb.length)
  assert.equal(server.getText('b').length, 0)
})
