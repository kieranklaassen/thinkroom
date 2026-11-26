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

test('retryable NACK merges inFlight back ahead of queuedUpdate and retries with bounded backoff', async (t) => {
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

test('ACK timeout requeues inFlight ahead of queuedUpdate and retries', async (t) => {
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
    fetchCalls.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive, headers: init.headers })
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
  assert.equal(fetchCalls[0].headers.Accept, 'application/json')
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

test('JSON writes ask for JSON, so a refusal is not a redirect that looks saved', async (t) => {
  const { postJSON } = await import('../../app/frontend/lib/csrf.ts')
  const originalFetch = globalThis.fetch
  let headers
  globalThis.fetch = async (_url, init) => {
    headers = init.headers
    return { ok: false, status: 423 }
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  await postJSON('/d/demo-slug/snapshot', {})
  assert.equal(headers.Accept, 'application/json')
})
