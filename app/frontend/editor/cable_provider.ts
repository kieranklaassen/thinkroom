import type { Consumer, Subscription } from '@rails/actioncable'
import { getConsumer } from '../lib/cable'
import { csrfToken } from '../lib/csrf'
import type { MermaidRenderHints } from './mermaid'
import type { CollaboratorKind } from '../types/payloads'
import * as Y from 'yjs'

/** Wire shape of Document#render_hints — client-measured render geometry
 * namespaced by renderer. Shared by the show props, the editor props, and
 * the durable snapshot payload so the three cannot drift. */
export interface RenderHints {
  mermaid?: MermaidRenderHints
}
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'

type SyncMessage = {
  type:
    | 'sync'
    | 'sync-reply'
    | 'update'
    | 'ack'
    | 'nack'
    | 'awareness'
    | 'awareness-leave'
    | 'write-denied'
  update?: string
  sv?: string
  checksum?: string
  seed?: boolean
  /** Nothing is stored yet and another client holds the seed claim, so this
   *  empty state is not the document. Viewers who cannot write also get the
   *  seed fields, to show locally. */
  seed_pending?: boolean
  content_format?: 'markdown' | 'html'
  seed_content?: string
  seed_author_kind?: CollaboratorKind | null
  seed_author_name?: string | null
  cid?: string
  client_id?: number
  seq?: number
  /** Reason string from nack frames or early subscribe-time rejections (e.g. 'retryable', 'invalid', 'stale'). */
  reason?: string
  /** Document#content_generation at the time of this message. */
  generation?: number
  /** True when a write-denied frame was rejected for staleness (the
   *  document was replaced since this client last synced) rather than a
   *  locked-link permission denial. */
  stale?: boolean
}

const AWARENESS_THROTTLE_MS = 100

export interface DurableSnapshotPayload {
  content: string
  spans: unknown[]
  state_vector: string
  /** Client-measured render geometry (Mermaid figure heights by source hash)
   *  persisted server-side so future loads reserve space before rendering. */
  render_hints?: RenderHints
}

export interface CableProviderOptions {
  consumer?: Consumer
  canWrite?: boolean
  connectionIdentity?: string
  initialChecksum?: string | null
  initialGeneration?: number | null
  ackTimeoutMs?: number
  retryBaseMs?: number
  retryMaxMs?: number
  seedRetryMs?: number
}

const toBase64 = (u8: Uint8Array): string => {
  let binary = ''
  u8.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

const fromBase64 = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

const EMPTY_UPDATE = new Uint8Array([0, 0])
const DEFAULT_ACK_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_BASE_MS = 250
const DEFAULT_RETRY_MAX_MS = 8_000
const DEFAULT_SEED_RETRY_MS = 3_000

// The exact v1 update carrying no structs and no deletes.
const isEmptyUpdate = (update: Uint8Array): boolean =>
  update.length === EMPTY_UPDATE.length && update.every((byte, i) => byte === EMPTY_UPDATE[i])

export type ProviderEvent = 'synced' | 'seed' | 'rejected' | 'write-denied' | 'stale'

/** Origin tag for the page's server-rendered Yjs state applied at session
 *  creation (collab_session.ts). It is server state, never a local change. */
export const SERVER_HYDRATE_ORIGIN = 'server-hydrate'

/**
 * Yjs provider over Rails ActionCable. Speaks the SyncChannel protocol:
 * the server transmits full state on subscribe; we apply it, flush any
 * unacked local edits from our outbox, and from then on send at most one
 * update frame in flight at a time, coalescing local edits via
 * `Y.mergeUpdates` while awaiting each server `ack` receipt.
 * Awareness piggybacks on the same subscription, relay-only. Reconnects
 * re-run the handshake automatically because ActionCable re-fires `connected`
 * -> server re-transmits sync.
 */
export class CableProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly clientId = crypto.randomUUID()
  synced = false
  seedContent: string | null = null
  seedFormat: 'markdown' | 'html' = 'markdown'
  // Seed authorship rides alongside seedContent with the same one-shot
  // consume semantics: the editor reads and nulls all three together so a
  // remount can never re-attribute.
  seedAuthorKind: CollaboratorKind | null = null
  seedAuthorName: string | null = null

  private subscription: Subscription
  private consumer: Consumer
  private listeners = new Map<ProviderEvent, Set<() => void>>()
  private destroyed = false
  private updateSequence = 0
  // SHA-256 of the last server yjs_state blob hydrated or synced into this
  // doc. Sent in SyncChannel subscribe params so an unchanged document skips
  // re-sending state and instantiating Y::Doc server-side.
  private serverChecksum: string | null = null
  private awarenessPending = false
  private awarenessThrottleTimer: ReturnType<typeof setTimeout> | null = null
  private lastAwarenessSentAt = 0
  // Single-in-flight coalescing outbox: at most one frame awaits server ACK at
  // a time. Local edits produced while offline, awaiting ACK, or backing off
  // accumulate in `queuedUpdate` via `Y.mergeUpdates`. Exact unacked state
  // (`inFlight` + `queuedUpdate`) tells us deterministically whether local
  // edits owe a flush on reconnect or unload — a read-only open has neither
  // and sends nothing.
  private inFlight: { seq: number; update: Uint8Array } | null = null
  private queuedUpdate: Uint8Array | null = null
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  // Waiting for another client to apply the seed: no 'synced' until content
  // arrives or this client is granted the claim.
  private seedWaiting = false
  private seedTimer: ReturnType<typeof setTimeout> | null = null
  // A viewer who cannot write is showing the seed from its own local copy.
  // Merging real state into that copy would duplicate the text.
  private localSeed = false
  private localSeedDiscarded = false
  // Initialized from documents#show props and verified on each "sync" message,
  // then echoed back on outgoing update/sync-reply frames, reconnect subscribe
  // params, and keepalive HTTP flushes so the server rejects any client whose
  // local Yjs doc predates an owner CLI replacement (Document#replace_content!).
  private generation: number | null
  private readonly slug: string
  private readonly canWrite: boolean
  private readonly ackTimeoutMs: number
  private readonly retryBaseMs: number
  private readonly retryMaxMs: number
  private readonly seedRetryMs: number

  constructor(doc: Y.Doc, slug: string, options?: CableProviderOptions) {
    this.doc = doc
    this.slug = slug
    this.canWrite = options?.canWrite ?? true
    this.serverChecksum = options?.initialChecksum ?? null
    this.generation =
      typeof options?.initialGeneration === 'number' ? options.initialGeneration : null
    this.ackTimeoutMs = options?.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS
    this.retryBaseMs = options?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
    this.retryMaxMs = options?.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
    this.seedRetryMs = options?.seedRetryMs ?? DEFAULT_SEED_RETRY_MS
    this.awareness = new Awareness(doc)
    this.consumer = options?.consumer ?? getConsumer(options?.connectionIdentity)

    this.subscription = this.consumer.subscriptions.create(
      this.buildSubscribeParams(),
      {
        received: (data: SyncMessage) => this.handleReceived(data),
        disconnected: () => {
          this.synced = false
          this.clearRetryTimer()
          this.stopSeedWait()
          this.requeueInFlight()
          this.clearAwarenessThrottle()
          // Refresh the ActionCable subscription identifier while the socket is
          // closed so the next automatic reload() carries our latest checksum,
          // state vector, and content generation.
          if (!this.destroyed && 'identifier' in this.subscription) {
            ;(this.subscription as { identifier: string }).identifier = JSON.stringify(
              this.buildSubscribeParams(),
            )
          }
          // Peers' presence is unknown while offline; drop all remote states.
          const remote = Array.from(this.awareness.getStates().keys()).filter(
            (id) => id !== this.doc.clientID,
          )
          if (remote.length > 0) removeAwarenessStates(this.awareness, remote, this)
        },
        rejected: () => {
          // The channel rejects when the document no longer exists (e.g. it
          // was deleted while this client was offline). Without this, the
          // user keeps typing into a dead editor that will never sync.
          this.synced = false
          this.clearOutbox()
          this.stopSeedWait()
          this.clearAwarenessThrottle()
          this.emit('rejected')
        },
      },
    )

    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleUnload)
      window.addEventListener('blur', this.handleBlur)
    }
  }

  on(event: ProviderEvent, handler: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler)
  }

  off(event: ProviderEvent, handler: () => void): void {
    this.listeners.get(event)?.delete(handler)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.handleUnload()
    this.flushAwareness()
    this.clearAwarenessThrottle()
    this.clearTimers()
    this.stopSeedWait()
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleUnload)
      window.removeEventListener('blur', this.handleBlur)
    }
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.subscription.unsubscribe()
    this.awareness.destroy()
  }

  private buildSubscribeParams(): { channel: 'SyncChannel'; [key: string]: unknown } {
    const params: { channel: 'SyncChannel'; [key: string]: unknown } = {
      channel: 'SyncChannel',
      slug: this.slug,
      cid: this.clientId,
      client_id: this.doc.clientID,
    }
    if (this.serverChecksum) params.checksum = this.serverChecksum
    if (this.doc.store.clients.size > 0) {
      params.sv = toBase64(Y.encodeStateVector(this.doc))
    }
    if (this.generation !== null) params.generation = this.generation
    return params
  }

  private emit(event: ProviderEvent): void {
    // Isolate listener failures: one stale handler (e.g. bound to a
    // destroyed editor) must never prevent the others from running.
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler()
      } catch (error) {
        console.error(`CableProvider ${event} listener failed`, error)
      }
    })
  }

  private send(payload: Record<string, unknown>): void {
    this.subscription.send({ ...payload, cid: this.clientId })
  }

  private enqueue(update: Uint8Array): void {
    this.queuedUpdate = this.queuedUpdate
      ? Y.mergeUpdates([this.queuedUpdate, update])
      : update
  }

  private requeueInFlight(): void {
    this.clearAckTimer()
    if (!this.inFlight) return
    const { update } = this.inFlight
    this.inFlight = null
    this.queuedUpdate = this.queuedUpdate
      ? Y.mergeUpdates([update, this.queuedUpdate])
      : update
  }

  private mergedUnackedUpdate(): Uint8Array | null {
    if (this.inFlight && this.queuedUpdate) {
      return Y.mergeUpdates([this.inFlight.update, this.queuedUpdate])
    }
    return this.inFlight?.update ?? this.queuedUpdate
  }

  private clearAckTimer(): void {
    if (this.ackTimer) {
      clearTimeout(this.ackTimer)
      this.ackTimer = null
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private clearTimers(): void {
    this.clearAckTimer()
    this.clearRetryTimer()
  }

  private clearOutbox(): void {
    this.clearTimers()
    this.inFlight = null
    this.queuedUpdate = null
    this.retryAttempt = 0
  }

  private stopSeedWait(): void {
    this.seedWaiting = false
    if (this.seedTimer) clearTimeout(this.seedTimer)
    this.seedTimer = null
  }

  private waitForSeed(): void {
    this.stopSeedWait()
    this.seedWaiting = true
    if (!this.canWrite) return
    this.seedTimer = setTimeout(() => {
      // Answered with a whole new handshake: content, a grant, or still pending.
      this.send({ type: 'seed-request' })
      this.seedTimer = setTimeout(() => this.waitForSeed(), this.ackTimeoutMs)
    }, this.seedRetryMs)
  }

  private completeSync(): void {
    this.stopSeedWait()
    this.synced = true
    this.flush('sync-reply')
    this.emit('synced')
    // Announce ourselves to the server cache and existing peers; cached
    // peer awareness arrives directly from SyncChannel#subscribed.
    this.broadcastAwareness()
  }

  // Once only: the page reloads in response, and later frames from a typing
  // peer must not keep restarting that reload.
  private discardLocalSeed(): void {
    if (this.localSeedDiscarded) return
    this.localSeedDiscarded = true
    this.emit('stale')
  }

  private flush(type: 'sync-reply' | 'update' = 'update'): void {
    if (
      this.destroyed ||
      !this.canWrite ||
      !this.synced ||
      this.inFlight ||
      this.retryTimer ||
      !this.queuedUpdate
    ) {
      return
    }
    const update = this.queuedUpdate
    this.queuedUpdate = null
    this.updateSequence += 1
    const seq = this.updateSequence
    this.inFlight = { seq, update }
    this.send({
      type,
      update: toBase64(update),
      seq,
      generation: this.generation,
    })
    this.ackTimer = setTimeout(() => this.handleAckTimeout(seq), this.ackTimeoutMs)
  }

  private handleAckTimeout(seq: number): void {
    this.ackTimer = null
    if (this.destroyed || !this.inFlight || this.inFlight.seq !== seq) return
    this.requeueInFlight()
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.destroyed || !this.synced || this.retryTimer || !this.queuedUpdate) return
    const exponent = Math.min(this.retryAttempt, 10)
    const delayMs = Math.min(this.retryBaseMs * 2 ** exponent, this.retryMaxMs)
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.flush('update')
    }, delayMs)
  }

  /**
   * Persist strictly the merged unacked outbox bytes (`inFlight` +
   * `queuedUpdate`) over a `keepalive` HTTP request so discrete edits or an
   * immediate navigation/unload survive ActionCable teardown.
   */
  persistCurrentState = (snapshot?: DurableSnapshotPayload): void => {
    if (!this.canWrite) return
    const snapInFlight = this.inFlight
    const snapQueued = this.queuedUpdate
    const pending = this.mergedUnackedUpdate()
    if (!pending && !snapshot) return

    const updatePayload = {
      update: toBase64(pending ?? EMPTY_UPDATE),
      cid: this.clientId,
      // Same staleness guard as flush(): this beforeunload/keepalive
      // fallback merges through the identical YjsPersistence.merge_bytes path
      // as SyncChannel, so it always carries content_generation (initialized
      // from page props even before the WebSocket handshake completes).
      generation: this.generation,
    }
    let body: string
    if (snapshot) {
      const completeBody = JSON.stringify({ ...updatePayload, ...snapshot })
      // Browsers cap keepalive request bodies at roughly 64 KiB. Large docs
      // still get durable CRDT state (and therefore correct reload behavior);
      // their derived source snapshot continues through the normal debounce.
      body =
        new TextEncoder().encode(completeBody).byteLength <= 60 * 1024
          ? completeBody
          : JSON.stringify(updatePayload)
    } else {
      body = JSON.stringify(updatePayload)
    }

    void fetch(`/d/${this.slug}/sync_update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken(),
      },
      body,
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (this.destroyed) return
        // Reconcile only the exact outbox snapshots this request carried; any
        // newer edits merged into `queuedUpdate` after fetch started remain.
        if (snapInFlight && this.inFlight === snapInFlight) {
          this.clearAckTimer()
          this.inFlight = null
          this.retryAttempt = 0
        }
        if (snapQueued) {
          if (this.queuedUpdate === snapQueued) {
            this.queuedUpdate = null
          } else if (!snapInFlight && this.inFlight?.update === snapQueued) {
            this.clearAckTimer()
            this.inFlight = null
            this.retryAttempt = 0
          }
        }
        this.flush('update')
      })
      .catch((error) => console.warn('CableProvider: durable sync failed', error))
  }

  private handleReceived(data: SyncMessage): void {
    if (data.cid === this.clientId) return

    switch (data.type) {
      case 'sync': {
        // A reconnect handshake reporting a different generation means an
        // owner CLI replacement (Document#replace_content!) reset this
        // document while this client was disconnected — it missed both the
        // content_reset broadcast and the merge-time rejection. Its local
        // doc is stale: adopting the new generation and flushing queued edits
        // would upload pre-replacement state tagged with the current
        // generation, resurrecting content the replacement wiped. Discard the
        // session instead: same recovery action as a rejected stale frame.
        if (
          this.generation !== null &&
          typeof data.generation === 'number' &&
          data.generation !== this.generation
        ) {
          // Post-replacement the seed is pending again, so this handshake
          // may have granted it to us — hand it back so the page load that
          // replaces this discarded session can claim and apply the new
          // template instead of everyone waiting out SEED_CLAIM_TIMEOUT.
          if (data.seed) this.send({ type: 'seed-decline' })
          this.stopSeedWait()
          this.clearOutbox()
          this.emit('stale')
          break
        }
        // A late answer to a seed-request, not a new subscription: the
        // outbox and its sequence are live and must not be reset.
        if (this.synced) {
          if (data.seed) this.send({ type: 'seed-decline' })
          if (data.update) Y.applyUpdate(this.doc, fromBase64(data.update), this)
          break
        }
        if (this.localSeed) {
          if (data.seed || data.seed_pending) this.completeSync()
          else this.discardLocalSeed()
          break
        }
        // Apply server's delta or full state (empty string on checksum match);
        // any unacked local edits stay in the outbox and flush immediately once synced.
        if (data.update) {
          Y.applyUpdate(this.doc, fromBase64(data.update), this)
        }
        this.serverChecksum = data.checksum ?? null
        this.clearRetryTimer()
        this.requeueInFlight()
        this.updateSequence = 0
        this.retryAttempt = 0
        if (typeof data.generation === 'number') this.generation = data.generation
        const seedContent = data.seed_content
        // An unshared seed is safe to show only where it can never be sent.
        const showLocally =
          Boolean(data.seed_pending) && !this.canWrite && this.doc.store.clients.size === 0
        if ((data.seed || showLocally) && seedContent) {
          this.localSeed = !this.canWrite
          // No one listens to 'seed' by design: the editor reads
          // provider.seedContent directly inside its bind step, which runs
          // on the 'synced' emit below — this assignment is ordered before
          // it on purpose. Handling the seed in a 'seed' listener instead
          // would double-apply the template.
          this.seedContent = seedContent
          this.seedFormat = data.content_format ?? 'markdown'
          this.seedAuthorKind = data.seed_author_kind ?? null
          this.seedAuthorName = data.seed_author_name ?? null
          this.emit('seed')
        } else if (data.seed_pending && this.doc.store.clients.size === 0) {
          // Binding the editor now would replace the painted body with an
          // empty document.
          this.waitForSeed()
          break
        }
        this.completeSync()
        break
      }
      case 'ack':
        if (!this.inFlight || data.seq !== this.inFlight.seq) break
        this.clearAckTimer()
        this.inFlight = null
        this.retryAttempt = 0
        this.flush('update')
        break
      case 'nack':
        if (!this.inFlight || data.seq !== this.inFlight.seq) break
        if (data.reason === 'retryable') {
          this.requeueInFlight()
          this.scheduleRetry()
        } else {
          console.warn('CableProvider: server rejected update', data.reason)
          this.clearAckTimer()
          this.inFlight = null
          this.retryAttempt = 0
          this.flush('update')
        }
        break
      case 'update':
      case 'sync-reply':
        this.serverChecksum = null
        try {
          const update = fromBase64(data.update!)
          if (this.localSeed) {
            if (!isEmptyUpdate(update)) this.discardLocalSeed()
            break
          }
          Y.applyUpdate(this.doc, update, this)
        } catch (error) {
          // A malformed frame from a peer must not break this client's
          // sync handler; the doc itself is untouched by a failed apply.
          console.warn('CableProvider: dropped malformed update', error)
        }
        if (this.seedWaiting && this.doc.store.clients.size > 0) this.completeSync()
        break
      case 'awareness':
        if (data.update) {
          try {
            applyAwarenessUpdate(this.awareness, fromBase64(data.update), this)
          } catch (error) {
            console.warn('CableProvider: dropped malformed awareness update', error)
          }
        }
        break
      case 'awareness-leave':
        if (typeof data.client_id === 'number' && data.client_id !== this.doc.clientID) {
          removeAwarenessStates(this.awareness, [data.client_id], this)
        }
        break
      case 'write-denied':
        this.clearOutbox()
        // Distinguish "this link is locked" from "your local doc predates an
        // owner CLI replacement" (Document#content_generation mismatch) —
        // each needs a different client recovery action (see show.tsx).
        this.emit(data.stale || data.reason === 'stale' ? 'stale' : 'write-denied')
        break
    }
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Updates we applied from the wire carry `this` as origin — don't echo
    // them; the page's server-rendered hydration is server state too.
    if (origin === this || origin === SERVER_HYDRATE_ORIGIN || !this.canWrite) return
    this.enqueue(update)
    this.flush('update')
  }

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this || !this.synced) return
    const localChanged =
      added.includes(this.doc.clientID) ||
      updated.includes(this.doc.clientID) ||
      removed.includes(this.doc.clientID)
    if (!this.subscription || !localChanged) return

    this.awarenessPending = true
    if (origin === 'unload' || removed.includes(this.doc.clientID)) {
      this.flushAwareness()
      return
    }

    const elapsed = Date.now() - this.lastAwarenessSentAt
    if (elapsed >= AWARENESS_THROTTLE_MS && this.awarenessThrottleTimer === null) {
      this.flushAwareness()
    } else if (this.awarenessThrottleTimer === null) {
      this.awarenessThrottleTimer = setTimeout(
        () => this.flushAwareness(),
        Math.max(0, AWARENESS_THROTTLE_MS - elapsed),
      )
    }
  }

  private flushAwareness(): void {
    if (this.awarenessThrottleTimer !== null) {
      clearTimeout(this.awarenessThrottleTimer)
      this.awarenessThrottleTimer = null
    }
    if (!this.awarenessPending || !this.subscription) return
    this.awarenessPending = false
    if (!this.awareness.meta.has(this.doc.clientID)) return
    this.lastAwarenessSentAt = Date.now()
    this.send({
      type: 'awareness',
      client_id: this.doc.clientID,
      update: toBase64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])),
    })
  }

  private clearAwarenessThrottle(): void {
    if (this.awarenessThrottleTimer !== null) {
      clearTimeout(this.awarenessThrottleTimer)
      this.awarenessThrottleTimer = null
    }
    this.awarenessPending = false
  }

  private broadcastAwareness(): void {
    if (this.awareness.getLocalState() === null) return
    this.awarenessPending = true
    this.flushAwareness()
  }

  private handleBlur = (): void => {
    this.flushAwareness()
    queueMicrotask(() => {
      if (!this.destroyed) this.flushAwareness()
    })
  }

  private handleUnload = (): void => {
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload')
    if (this.inFlight || this.queuedUpdate) {
      this.persistCurrentState()
    }
  }
}
