// Two-client CRDT convergence proof — no browser involved.
//
// Speaks the SyncChannel wire protocol directly from Node with two
// independent Yjs docs over two ActionCable connections, makes concurrent
// edits, and asserts both replicas (and a late-joining third) converge to
// identical state vectors. Usage:
//
//   BASE_URL=http://localhost:3000 node script/sync_check.mjs
//
import * as Y from 'yjs'
import { createConsumer, adapters } from '@rails/actioncable'

adapters.WebSocket = WebSocket // Node 22+ ships a native WebSocket

// @rails/actioncable expects a browser; give it the two globals it touches.
globalThis.addEventListener ??= () => {}
globalThis.removeEventListener ??= () => {}
globalThis.document ??= { visibilityState: 'visible' }

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const WS = BASE.replace(/^http/, 'ws') + '/cable'

const ok = (msg) => console.log(`✓ ${msg}`)
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const toBase64 = (u8) => Buffer.from(u8).toString('base64')
const fromBase64 = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))

/** Minimal provider speaking the SyncChannel single-in-flight ACK/NACK protocol. */
function connect(slug, label) {
  const doc = new Y.Doc()
  const consumer = createConsumer(WS)
  const cid = `${label}-${Math.random().toString(36).slice(2)}`
  let synced = false
  let updateSequence = 0
  let inFlight = null
  let queuedUpdate = null
  let retryTimer = null
  let acksReceived = 0
  let generation = null
  const syncedPromise = {}
  syncedPromise.promise = new Promise((resolve) => (syncedPromise.resolve = resolve))

  function flush(type = 'update') {
    if (!synced || inFlight || retryTimer || !queuedUpdate) return
    const update = queuedUpdate
    queuedUpdate = null
    updateSequence += 1
    inFlight = { seq: updateSequence, update }
    subscription.send({
      type,
      update: toBase64(update),
      cid,
      seq: inFlight.seq,
      generation,
    })
  }

  const subscription = consumer.subscriptions.create(
    { channel: 'SyncChannel', slug },
    {
      received(data) {
        if (data.cid === cid) return
        switch (data.type) {
          case 'sync': {
            Y.applyUpdate(doc, fromBase64(data.update), 'remote')
            if (retryTimer) {
              clearTimeout(retryTimer)
              retryTimer = null
            }
            if (inFlight) {
              queuedUpdate = queuedUpdate
                ? Y.mergeUpdates([inFlight.update, queuedUpdate])
                : inFlight.update
              inFlight = null
            }
            updateSequence = 0
            generation = data.generation
            synced = true
            flush('sync-reply')
            syncedPromise.resolve()
            break
          }
          case 'ack':
            if (!inFlight || data.seq !== inFlight.seq) break
            acksReceived += 1
            inFlight = null
            flush('update')
            break
          case 'nack':
            if (!inFlight || data.seq !== inFlight.seq) break
            if (data.reason === 'retryable') {
              queuedUpdate = queuedUpdate
                ? Y.mergeUpdates([inFlight.update, queuedUpdate])
                : inFlight.update
              inFlight = null
              retryTimer = setTimeout(() => {
                retryTimer = null
                flush('update')
              }, 100)
            } else {
              inFlight = null
              flush('update')
            }
            break
          case 'update':
          case 'sync-reply':
            Y.applyUpdate(doc, fromBase64(data.update), 'remote')
            break
        }
      },
      disconnected() {
        synced = false
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        if (inFlight) {
          queuedUpdate = queuedUpdate
            ? Y.mergeUpdates([inFlight.update, queuedUpdate])
            : inFlight.update
          inFlight = null
        }
      },
    },
  )

  doc.on('update', (update, origin) => {
    if (origin === 'remote') return
    queuedUpdate = queuedUpdate ? Y.mergeUpdates([queuedUpdate, update]) : update
    flush('update')
  })

  return {
    doc,
    consumer,
    synced: () => syncedPromise.promise,
    drained: () => !inFlight && !queuedUpdate,
    acks: () => acksReceived,
    label,
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, what, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await sleep(100)
  }
  fail(`timed out waiting for ${what}`)
}

// --- Setup: a fresh document via the agent API ---
const created = await (
  await fetch(`${BASE}/api/docs`, {
    method: 'POST',
    headers: { 'X-Agent-Name': 'sync-check', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Sync check', markdown: '# Sync check' }),
  })
).json()
const slug = created.slug
ok(`created test document ${slug}`)

// --- Clients A and B connect and complete the handshake ---
const a = connect(slug, 'A')
const b = connect(slug, 'B')
await a.synced()
await b.synced()
ok('both clients completed the sync handshake')

// --- Simple propagation: A writes, B sees it ---
a.doc.getText('check').insert(0, 'hello from A. ')
await waitFor(
  () => b.doc.getText('check').toString().includes('hello from A'),
  'A’s edit to reach B',
)
ok('edit from A propagated to B')

// --- Concurrent edits: both clients type simultaneously ---
for (let i = 0; i < 20; i += 1) {
  a.doc.getText('check').insert(a.doc.getText('check').length, `A${i};`)
  b.doc.getText('check').insert(0, `B${i};`)
  // interleave without awaiting — genuine concurrency over the wire
}
await waitFor(
  () => {
    const aNow = a.doc.getText('check').toString()
    const bNow = b.doc.getText('check').toString()
    return (
      a.drained() &&
      b.drained() &&
      aNow === bNow &&
      aNow.includes('A19;') &&
      aNow.includes('B19;')
    )
  },
  'both outboxes to drain ACKs and 40 concurrent edits to converge',
  30000,
)
if (a.acks() === 0 || b.acks() === 0) {
  fail(`expected explicit ACK receipts (A=${a.acks()}, B=${b.acks()})`)
}
ok(`coalescing outboxes drained with explicit ACKs (A=${a.acks()}, B=${b.acks()})`)

const aText = a.doc.getText('check').toString()
const bText = b.doc.getText('check').toString()
if (aText !== bText) {
  fail(`replicas diverged:\n  A: ${aText}\n  B: ${bText}`)
}
for (let i = 0; i < 20; i += 1) {
  if (!aText.includes(`A${i};`) || !aText.includes(`B${i};`)) {
    fail(`lost concurrent edit (A${i}/B${i}) — last-write-wins behavior detected`)
  }
}
ok('40 concurrent edits from two clients converged with no loss')

const aVector = toBase64(Y.encodeStateVector(a.doc))
const bVector = toBase64(Y.encodeStateVector(b.doc))
if (aVector !== bVector) fail('state vectors differ between replicas')
ok('state vectors identical — true CRDT convergence, not last-write-wins')

// --- Persistence: a late joiner gets the converged state from the server ---
a.consumer.disconnect()
b.consumer.disconnect()
await sleep(500)

const c = connect(slug, 'C')
await c.synced()
await waitFor(
  () => c.doc.getText('check').toString() === aText,
  'late joiner to receive persisted state',
)
ok('late-joining client received the full converged state from server persistence')
c.consumer.disconnect()

console.log('\nSync check passed: conflict-free convergence + server persistence.')
process.exit(0)
