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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  globalThis.fetch = (url, init) => {
    const bytes = new TextEncoder().encode(init.body).byteLength
    const call = { url, bytes, keepalive: init.keepalive === true, body: JSON.parse(init.body), refused: false }
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
      call.respond = (status = 204) =>
        settle(() => resolve({ ok: status < 400, status, json: async () => null }))
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

test('pagehide alone flushes unacked in-flight and queued edits', (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'in-flight-')
  h.doc.getText('t').insert(10, 'queued')

  window.dispatchEvent('pagehide')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/d/demo-slug/sync_update')
  assert.equal(calls[0].keepalive, true)
  assert.equal(savedText(calls[0]), 'in-flight-queued')
})

test('beforeunload followed by pagehide with no new edits sends one save and counts keepalive once', (t) => {
  const { calls } = stubLimitedFetch(t)
  editedHarness(t, 25_000)

  window.dispatchEvent('beforeunload')
  window.dispatchEvent('pagehide')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].keepalive, true)
  assert.equal(calls[0].refused, false)
  assert.equal(savedText(calls[0]).length, 25_000)

  editedHarness(t, 20_000).provider.persistCurrentState()
  assert.equal(calls[1].keepalive, true, 'pagehide must not double-count keepalive bytes')
  assert.equal(calls[1].refused, false)
})

test('an edit made between beforeunload and pagehide is flushed on pagehide', (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'before-')

  window.dispatchEvent('beforeunload')
  assert.equal(calls.length, 1)
  assert.equal(savedText(calls[0]), 'before-')

  h.doc.getText('t').insert(7, 'after')
  window.dispatchEvent('pagehide')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].keepalive, true)
  assert.equal(savedText(calls[1]), 'before-after')
})

test('pagehide flushes remaining unacked edits after a failed or partial beforeunload save', async (t) => {
  for (const settle of [(call) => call.fail(), (call) => call.respond(423)]) {
    const { calls } = stubLimitedFetch(t)
    const h = createHarness(t, { ackTimeoutMs: 5000 })
    h.receive(emptySyncFrame(1))
    h.doc.getText('t').insert(0, 'retry-me')

    window.dispatchEvent('beforeunload')
    assert.equal(calls.length, 1)
    await settle(calls[0])

    window.dispatchEvent('pagehide')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].keepalive, true)
    assert.equal(savedText(calls[1]), 'retry-me')
    h.provider.destroy()
  }

  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'settled')

  window.dispatchEvent('beforeunload')
  h.doc.getText('t').insert(0, 'remaining-')
  await calls[0].respond(204)

  window.dispatchEvent('pagehide')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].keepalive, true)
  assert.equal(savedText(calls[0]), 'settled')
  assert.equal(savedByAll(calls), 'remaining-settled')
})

test('destroy removes the pagehide listener so later pagehide events do not flush again', async (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'once')

  h.provider.destroy()
  assert.equal(calls.length, 1)
  await calls[0].fail()

  window.dispatchEvent('pagehide')
  window.dispatchEvent('beforeunload')
  assert.equal(calls.length, 1)
})

test('pagehide upgrades an in-flight non-keepalive save once budget frees up, without duplicating >64 KiB saves', async (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = editedHarness(t, 30_000)

  // Save 1 holds ~40 KiB of the 64 KiB keepalive budget.
  h.provider.persistCurrentState()
  // Save 2 carries the new edit with keepalive: false because budget is full.
  h.doc.getText('t').insert(0, 'later-')
  h.provider.persistCurrentState()
  assert.deepEqual(
    calls.map((call) => call.keepalive),
    [true, false],
  )

  // Save 1 settles, freeing keepalive room while Save 2 (keepalive: false) is still in flight.
  await calls[0].respond(204)
  window.dispatchEvent('pagehide')
  assert.equal(calls.length, 3)
  assert.equal(calls[2].keepalive, true)
  assert.equal(savedByAll([calls[0], calls[2]]), h.doc.getText('t').toString())
  h.provider.destroy()

  // A >64 KiB edit cannot fit keepalive, so beforeunload + pagehide still sends only one request.
  const large = stubLimitedFetch(t)
  editedHarness(t, 100_000)
  window.dispatchEvent('beforeunload')
  window.dispatchEvent('pagehide')
  assert.equal(large.calls.length, 1)
  assert.equal(large.calls[0].keepalive, false)
})

test('overlapping saves hold unload deduplication until the last save carrying a part settles', async (t) => {
  const { calls } = stubLimitedFetch(t)
  const h = createHarness(t, { ackTimeoutMs: 5000 })
  h.receive(emptySyncFrame(1))
  h.doc.getText('t').insert(0, 'overlap')

  h.provider.persistCurrentState()
  h.provider.persistCurrentState()
  assert.equal(calls.length, 2)

  // First save fails while second keepalive save is still in flight: pagehide must not resend yet.
  await calls[0].fail()
  window.dispatchEvent('pagehide')
  assert.equal(calls.length, 2)

  // Once the second save also fails, pagehide flushes the still-unacked edit.
  await calls[1].fail()
  window.dispatchEvent('pagehide')
  assert.equal(calls.length, 3)
  assert.equal(calls[2].keepalive, true)
  assert.equal(savedText(calls[2]), 'overlap')
})
