import type { Consumer, Subscription } from '@rails/actioncable'
import { getConsumer } from '../lib/cable'
import type { MermaidRenderHints } from './mermaid'
import type { CollaboratorKind } from '../types/payloads'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { AwarenessRelay } from './awareness_relay'
import { DurableSaves } from './durable_saves'
import { SeedWait } from './seed_wait'
import { MAX_UPDATE_BYTES, fromBase64, isEmptyUpdate, toBase64, type SyncMessage } from './sync_wire'
import { UpdateOutbox } from './update_outbox'

/** Wire shape of Document#render_hints — client-measured render geometry
 * namespaced by renderer. Shared by the show props, the editor props, and
 * the durable snapshot payload so the three cannot drift. */
export interface RenderHints {
  mermaid?: MermaidRenderHints
}

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

const DEFAULT_ACK_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_BASE_MS = 250
const DEFAULT_RETRY_MAX_MS = 8_000
const DEFAULT_SEED_RETRY_MS = 3_000

export type ProviderEvent =
  | 'synced'
  | 'seed'
  | 'rejected'
  | 'write-denied'
  | 'stale'
  | 'access-changed'
  | 'unsaved-edit'

/** Origin tag for the page's server-rendered Yjs state applied at session
 *  creation (collab_session.ts). It is server state, never a local change. */
export const SERVER_HYDRATE_ORIGIN = 'server-hydrate'

/**
 * Yjs provider over Rails ActionCable. Speaks the SyncChannel protocol:
 * the server transmits full state on subscribe; we apply it, flush any
 * unacked local edits from our outbox, and from then on send local edits as
 * the outbox allows.
 * Awareness piggybacks on the same subscription, relay-only. Reconnects
 * re-run the handshake automatically because ActionCable re-fires `connected`
 * -> server re-transmits sync.
 */
export class CableProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly clientId = crypto.randomUUID()
  synced = false
  /** A local edit was too large for the server. Later local edits follow it in
   *  the Yjs history and can depend on it, so none is sent. Undo
   *  does not help (the history keeps the text), so this lasts as long as the
   *  session. */
  unsavedEdit = false
  seedContent: string | null = null
  /** Held from the seed grant until the server is known to store this
   *  client's seed; sent with every write in between. */
  seedClaim: string | null = null
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
  // SHA-256 of the last server yjs_state blob hydrated or synced into this
  // doc. Sent in SyncChannel subscribe params so an unchanged document skips
  // re-sending state and instantiating Y::Doc server-side.
  private serverChecksum: string | null = null
  private readonly outbox: UpdateOutbox
  private readonly saves: DurableSaves
  private readonly seedWait: SeedWait
  private readonly presence: AwarenessRelay
  // A viewer who cannot write is showing the seed from its own local copy.
  // Merging real state into that copy would duplicate the text.
  private localSeed = false
  // The local doc was superseded and the page is reloading: nothing more is
  // sent from it or merged into it.
  discarded = false
  // Peer updates that arrived while `seedClaim` was unsettled. Merging them
  // into a seed the server then refuses would double the text.
  private heldUpdates: Uint8Array[] = []
  // Initialized from documents#show props and verified on each "sync" message,
  // then echoed back on outgoing update/sync-reply frames, reconnect subscribe
  // params, and keepalive HTTP flushes so the server rejects any client whose
  // local Yjs doc predates an owner CLI replacement (Document#replace_content!).
  private generation: number | null
  private readonly slug: string
  private readonly canWrite: boolean

  constructor(doc: Y.Doc, slug: string, options?: CableProviderOptions) {
    this.doc = doc
    this.slug = slug
    this.canWrite = options?.canWrite ?? true
    this.serverChecksum = options?.initialChecksum ?? null
    this.generation =
      typeof options?.initialGeneration === 'number' ? options.initialGeneration : null
    const ackTimeoutMs = options?.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS
    this.awareness = new Awareness(doc)
    this.presence = new AwarenessRelay({
      awareness: this.awareness,
      send: (frame) => this.send(frame),
      isSynced: () => this.synced,
      channelOrigin: this,
    })
    this.saves = new DurableSaves(slug)
    this.outbox = new UpdateOutbox({
      ackTimeoutMs,
      retryBaseMs: options?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
      retryMaxMs: options?.retryMaxMs ?? DEFAULT_RETRY_MAX_MS,
      canSend: () => !this.destroyed && !this.discarded && this.canWrite && this.synced,
      transmit: (type, seq, update) =>
        this.send({ type, update: toBase64(update), seq, ...this.writeGuard() }),
      isInSave: this.saves.carries,
    })
    this.seedWait = new SeedWait({
      canRequest: this.canWrite,
      retryMs: options?.seedRetryMs ?? DEFAULT_SEED_RETRY_MS,
      answerTimeoutMs: ackTimeoutMs,
      request: () => this.send({ type: 'seed-request' }),
    })
    this.consumer = options?.consumer ?? getConsumer(options?.connectionIdentity)

    this.subscription = this.consumer.subscriptions.create(
      this.buildSubscribeParams(),
      {
        received: (data: SyncMessage) => this.handleReceived(data),
        disconnected: () => {
          this.synced = false
          this.outbox.suspend()
          this.seedWait.stop()
          this.presence.cancel()
          // Refresh the ActionCable subscription identifier while the socket is
          // closed so the next automatic reload() carries our latest checksum,
          // state vector, and content generation.
          if (!this.destroyed && 'identifier' in this.subscription) {
            ;(this.subscription as { identifier: string }).identifier = JSON.stringify(
              this.buildSubscribeParams(),
            )
          }
          // Peers' presence is unknown while offline; drop all remote states.
          this.presence.dropAllPeers()
        },
        rejected: () => {
          // The channel rejects when the document no longer exists (e.g. it
          // was deleted while this client was offline). Without this, the
          // user keeps typing into a dead editor that will never sync.
          this.synced = false
          this.outbox.clear()
          this.seedWait.stop()
          this.presence.cancel()
          this.emit('rejected')
        },
      },
    )

    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.presence.handleChange)
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleUnload)
      window.addEventListener('pagehide', this.handleUnload)
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
    this.presence.flush()
    this.outbox.stopTimers()
    this.seedWait.stop()
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleUnload)
      window.removeEventListener('pagehide', this.handleUnload)
      window.removeEventListener('blur', this.handleBlur)
    }
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.presence.handleChange)
    this.subscription.unsubscribe()
    this.awareness.destroy()
  }

  /** Edits the server has not confirmed, for inspection. */
  get inFlight(): UpdateOutbox['inFlight'] {
    return this.outbox.inFlight
  }

  get queued(): Uint8Array[] {
    return this.outbox.queued
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

  private completeSync(): void {
    this.seedWait.stop()
    this.synced = true
    this.outbox.flush('sync-reply')
    this.emit('synced')
    // Announce ourselves to the server cache and existing peers; cached
    // peer awareness arrives directly from SyncChannel#subscribed.
    this.presence.announce()
  }

  // Once only: the page reloads in response, and later frames from a typing
  // peer must not keep restarting that reload.
  private discardLocalSeed(): void {
    if (this.discarded) return
    this.discarded = true
    this.seedWait.stop()
    this.outbox.clear()
    this.heldUpdates = []
    this.emit('stale')
  }

  private takeOrDeclineSeedClaim(claim: string | undefined, hasSeedToStore: boolean): void {
    if (hasSeedToStore) this.seedClaim = claim ?? null
    else this.send({ type: 'seed-decline' })
  }

  private settleSeedClaim(): void {
    if (this.seedClaim === null) return
    this.seedClaim = null
    const held = this.heldUpdates
    this.heldUpdates = []
    for (const update of held) {
      try {
        Y.applyUpdate(this.doc, update, this)
      } catch (error) {
        console.warn('CableProvider: dropped malformed update', error)
      }
    }
  }

  // Peer updates are held while a claim is unsettled, so every struct in the
  // local doc is this client's own.
  private serverHoldsOwnSeed(stateVector: Map<number, number>): boolean {
    return [...this.doc.store.clients.keys()].some((client) => stateVector.has(client))
  }

  // The same staleness and claim guard goes with every write, over the socket
  // or HTTP: both merge through YjsPersistence.merge_bytes. The generation is
  // initialized from page props, so it is there before the handshake completes.
  private writeGuard(): { generation: number | null; seed_claim?: string } {
    const claim = this.seedClaim === null ? {} : { seed_claim: this.seedClaim }
    return { generation: this.generation, ...claim }
  }

  /**
   * Persist strictly the unacked outbox over an HTTP request, so discrete edits
   * or an immediate navigation/unload survive ActionCable teardown.
   */
  persistCurrentState = (snapshot?: DurableSnapshotPayload): void => {
    this.sendDurableSave(snapshot)
  }

  private sendDurableSave(snapshot?: DurableSnapshotPayload, unload = false): void {
    if (!this.canWrite || this.discarded) return
    const parts = this.outbox.unackedParts()
    const sentClaim = this.seedClaim
    this.saves.send({
      parts,
      guard: { cid: this.clientId, ...this.writeGuard() },
      snapshot,
      unload,
      onSeedRefused: () => {
        // Before the handshake this client may still be granted the claim
        // anew, so the handshake decides.
        const current = this.synced && this.seedClaim === sentClaim
        if (current && !this.destroyed) this.discardLocalSeed()
      },
      onStored: () => {
        if (this.destroyed || this.discarded) return
        if (parts.length > 0) this.settleSeedClaim()
        this.outbox.settleParts(parts)
        this.outbox.flush()
      },
    })
  }

  private handleReceived(data: SyncMessage): void {
    if (data.cid === this.clientId || this.discarded) return

    switch (data.type) {
      case 'sync':
        this.handleSync(data)
        break
      case 'ack':
        if (!this.outbox.awaitsReceipt(data.seq)) break
        this.outbox.settleInFlight()
        this.settleSeedClaim()
        this.outbox.flush()
        break
      case 'nack':
        if (!this.outbox.awaitsReceipt(data.seq)) break
        if (data.reason === 'retryable') {
          this.outbox.retryLater()
        } else {
          console.warn('CableProvider: server rejected update', data.reason)
          this.outbox.settleInFlight()
          this.outbox.flush()
        }
        break
      case 'update':
      case 'sync-reply':
        this.handlePeerUpdate(data)
        break
      case 'awareness':
        if (data.update) this.presence.receive(data.update)
        break
      case 'awareness-leave':
        if (typeof data.client_id === 'number') this.presence.dropPeer(data.client_id)
        break
      case 'write-denied':
        if (this.seedClaim !== null && (data.stale || data.reason === 'stale')) {
          this.discardLocalSeed()
          break
        }
        this.outbox.clear()
        // Distinguish "this link is locked" from "your local doc predates an
        // owner CLI replacement" (Document#content_generation mismatch) —
        // each needs a different client recovery action (see show.tsx).
        this.emit(data.stale || data.reason === 'stale' ? 'stale' : 'write-denied')
        break
    }
  }

  private handleSync(data: SyncMessage): void {
    const answersSeedRequest = this.seedWait.takeRequest()
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
      this.seedWait.stop()
      this.outbox.clear()
      this.emit('stale')
      return
    }
    if (this.seedClaim !== null && data.sv) {
      const stateVector = Y.decodeStateVector(fromBase64(data.sv))
      if (stateVector.size > 0 && !this.serverHoldsOwnSeed(stateVector)) {
        this.discardLocalSeed()
        return
      }
      if (stateVector.size > 0) this.settleSeedClaim()
    }
    if (this.localSeed) {
      const hasContent = Boolean(data.update) && !isEmptyUpdate(fromBase64(data.update!))
      if ((data.seed || data.seed_pending) && !hasContent) this.completeSync()
      else this.discardLocalSeed()
      return
    }
    // A late answer to a seed-request, not a new subscription: the
    // outbox and its sequence are live and must not be reset.
    if (this.synced && answersSeedRequest) {
      if (data.seed) this.takeOrDeclineSeedClaim(data.seed_claim, this.seedClaim !== null)
      if (data.update) Y.applyUpdate(this.doc, fromBase64(data.update), this)
      return
    }
    // Still synced means a half-open socket was replaced without
    // `disconnected`. Numbering continues then, so a receipt for the old
    // send cannot settle the new one.
    if (this.synced) this.synced = false
    else this.outbox.restartNumbering()
    // Apply server's delta or full state (empty string on checksum match);
    // any unacked local edits stay in the outbox and flush immediately once synced.
    if (data.update) {
      Y.applyUpdate(this.doc, fromBase64(data.update), this)
    }
    this.serverChecksum = data.checksum ?? null
    this.outbox.suspend()
    this.outbox.resetBackoff()
    if (typeof data.generation === 'number') this.generation = data.generation
    const seedContent = data.seed_content
    const localDocEmpty = this.doc.store.clients.size === 0
    if (data.seed && !this.canWrite && localDocEmpty) {
      // Only a writer is granted the claim. This session cannot use it, so
      // it goes back for the one the page opens with its current access.
      this.send({ type: 'seed-decline' })
      this.seedWait.start()
      this.emit('access-changed')
      return
    }
    if (data.seed && this.canWrite) {
      // A claim is for a seed still to be stored. With content here and
      // none of this client's own unsettled there is nothing to claim, and
      // holding it would keep peer edits back and get the next edit refused.
      this.takeOrDeclineSeedClaim(data.seed_claim, localDocEmpty || this.seedClaim !== null)
    }
    // An unshared seed is safe to show only where it can never be sent.
    const showLocally = Boolean(data.seed_pending) && !this.canWrite
    if ((data.seed || showLocally) && seedContent && localDocEmpty) {
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
    } else if (data.seed_pending && localDocEmpty) {
      // Binding the editor now would replace the painted body with an
      // empty document.
      this.seedWait.start()
      // A pending handshake carries the seed only for those who cannot write.
      const serverAllowsWrites = !seedContent
      if (this.canWrite !== serverAllowsWrites) this.emit('access-changed')
      return
    }
    this.completeSync()
  }

  private handlePeerUpdate(data: SyncMessage): void {
    this.serverChecksum = null
    try {
      const update = fromBase64(data.update!)
      if (this.localSeed) {
        if (!isEmptyUpdate(update)) this.discardLocalSeed()
        return
      }
      if (this.seedClaim !== null) {
        this.heldUpdates.push(update)
        return
      }
      Y.applyUpdate(this.doc, update, this)
    } catch (error) {
      // A malformed frame from a peer must not break this client's
      // sync handler; the doc itself is untouched by a failed apply.
      console.warn('CableProvider: dropped malformed update', error)
    }
    if (this.seedWait.waiting && this.doc.store.clients.size > 0) this.completeSync()
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Updates we applied from the wire carry `this` as origin — don't echo
    // them; the page's server-rendered hydration is server state too.
    if (origin === this || origin === SERVER_HYDRATE_ORIGIN || !this.canWrite) return
    if (this.unsavedEdit) return
    if (update.length > MAX_UPDATE_BYTES) {
      this.unsavedEdit = true
      this.emit('unsaved-edit')
      return
    }
    this.outbox.enqueue(update)
    this.outbox.flush()
  }

  private handleBlur = (): void => {
    this.presence.flush()
    queueMicrotask(() => {
      if (!this.destroyed) this.presence.flush()
    })
  }

  private handleUnload = (event?: Event): void => {
    if (!(event as PageTransitionEvent | undefined)?.persisted) {
      this.presence.leave()
    }
    this.sendDurableSave(undefined, true)
  }
}
