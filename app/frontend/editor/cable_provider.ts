import type { Consumer, Subscription } from '@rails/actioncable'
import { getConsumer } from '../lib/cable'
import { jsonHeaders } from '../lib/csrf'
import type { MermaidRenderHints } from './mermaid'
import type { CollaboratorKind } from '../types/payloads'
import { splitUpdate } from './split_update'
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
  seed_claim?: string
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
  /** One edit in pieces, to be applied together. */
  updates?: string[]
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
  uploadDeadlineMs?: (bytes: number) => number
  uploadWarnMs?: number
}

const toBase64 = (u8: Uint8Array): string => {
  let binary = ''
  u8.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const EMPTY_UPDATE = new Uint8Array([0, 0])
const DEFAULT_ACK_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_BASE_MS = 250
const DEFAULT_RETRY_MAX_MS = 8_000
const DEFAULT_SEED_RETRY_MS = 3_000

// Mirrors YjsPersistence::MAX_UPDATE_BYTES: the server takes no larger update,
// over the socket or HTTP.
const MAX_UPDATE_BYTES = 2 * 1024 * 1024
// Mirrors YjsPersistence::MAX_SPLIT_UPDATES and MAX_SPLIT_UPDATE_BYTES, sized
// from MAX_DOCUMENT_SIZE (document_size_guard.ts): 6 MiB text + 1 MiB structure.
const MAX_SPLIT_UPDATES = 5
const MAX_SPLIT_UPDATE_BYTES = 7 * 1024 * 1024
// What merging may add to a part: a filler for a gap before it.
const MERGE_BYTES_PER_PART = 16

// A minute to answer, and time to send the body at 50 KB/s.
const defaultUploadDeadlineMs = (bytes: number): number => 60_000 + bytes / 50
// How long a large edit may be owed before the page says it is not saved.
const DEFAULT_UPLOAD_WARN_MS = 30_000

// Groups neighbours whose merge one frame holds. An update larger than that
// stands alone.
const packUpdates = (updates: Uint8Array[]): Uint8Array[][] => {
  const groups: Uint8Array[][] = []
  let size = Infinity
  for (const update of updates) {
    size += update.length + MERGE_BYTES_PER_PART
    if (size > MAX_UPDATE_BYTES) {
      groups.push([])
      size = update.length
    }
    groups[groups.length - 1].push(update)
  }
  return groups
}

// Browsers refuse a keepalive request that takes the total of the page's
// keepalive bodies in flight past 64 KiB.
const KEEPALIVE_LIMIT_BYTES = 64 * 1024
const MAX_SAVE_WITH_SNAPSHOT_BYTES = 60 * 1024
let keepaliveBytesInFlight = 0

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength
const fitsKeepalive = (bytes: number): boolean =>
  keepaliveBytesInFlight + bytes <= KEEPALIVE_LIMIT_BYTES

// The exact v1 update carrying no structs and no deletes.
const isEmptyUpdate = (update: Uint8Array): boolean =>
  update.length === EMPTY_UPDATE.length && update.every((byte, i) => byte === EMPTY_UPDATE[i])

/** What an HTTP save came back with. */
type SaveAnswer = { status: number; seedRefused: boolean }

export type ProviderEvent =
  | 'synced'
  | 'seed'
  | 'rejected'
  | 'write-denied'
  | 'stale'
  | 'access-changed'
  | 'save-state'

/** A large edit not yet stored: still being sent, or stuck. */
export type SaveState = 'sending' | 'stuck' | null

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
  // accumulate in `queued` via `Y.mergeUpdates`. Exact unacked state
  // (`inFlight` + `queued`) tells us deterministically whether local
  // edits owe a flush on reconnect or unload — a read-only open has neither
  // and sends nothing.
  //
  // Both hold parts rather than one update: a part an HTTP save carried is never
  // merged with later edits, so the save's success settles that part alone.
  private inFlight: { seq: number; parts: Uint8Array[] } | null = null
  private queued: Uint8Array[] = []
  private carriedBySave = new WeakSet<Uint8Array>()
  // What the server takes in place of an update too large for it, or null when
  // it cannot be split.
  private pieces = new WeakMap<Uint8Array, Uint8Array[] | null>()
  private upload: { part: Uint8Array; abort: AbortController } | null = null
  /** Changes with the 'save-state' event. */
  saveState: SaveState = null
  // Large edits to call unsaved until they are stored: refused, or owed for a
  // while. Each has its own time.
  private unsaved = new WeakSet<Uint8Array>()
  private unsavedTimers = new Map<Uint8Array, ReturnType<typeof setTimeout>>()
  // The edit refused on this connection. Nothing more is sent while it is owed,
  // since every later edit builds on it.
  private refusedPart: Uint8Array | null = null
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  // Waiting for another client to apply the seed: no 'synced' until content
  // arrives or this client is granted the claim.
  private seedWaiting = false
  private seedTimer: ReturnType<typeof setTimeout> | null = null
  // A seed-request is unanswered, so the next handshake may be its answer.
  private seedRequested = false
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
  private readonly ackTimeoutMs: number
  private readonly retryBaseMs: number
  private readonly retryMaxMs: number
  private readonly seedRetryMs: number
  private readonly uploadDeadlineMs: (bytes: number) => number
  private readonly uploadWarnMs: number

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
    this.uploadDeadlineMs = options?.uploadDeadlineMs ?? defaultUploadDeadlineMs
    this.uploadWarnMs = options?.uploadWarnMs ?? DEFAULT_UPLOAD_WARN_MS
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
          this.refusedPart = null
          // Restarts the upload: its connection may be gone too, and waiting for
          // its deadline would take longer than sending it again.
          this.upload?.abort.abort()
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
    const last = this.queued[this.queued.length - 1]
    const fits = last && last.length + update.length + MERGE_BYTES_PER_PART <= MAX_UPDATE_BYTES
    if (last && fits && !this.carriedBySave.has(last)) {
      this.queued[this.queued.length - 1] = Y.mergeUpdates([last, update])
    } else {
      this.queued.push(update)
    }
  }

  private requeueInFlight(): void {
    this.clearAckTimer()
    if (!this.inFlight) return
    this.queued = [...this.inFlight.parts, ...this.queued]
    this.inFlight = null
  }

  private unackedParts(): Uint8Array[] {
    return [...(this.inFlight?.parts ?? []), ...this.queued]
  }

  private piecesOf(part: Uint8Array): Uint8Array[] | null {
    if (part.length <= MAX_UPDATE_BYTES) return [part]
    if (!this.pieces.has(part)) {
      const pieces = part.length > MAX_SPLIT_UPDATE_BYTES ? null : splitUpdate(part, MAX_UPDATE_BYTES)
      const total = pieces?.reduce((sum, piece) => sum + piece.length, 0) ?? Infinity
      const usable =
        pieces && pieces.length <= MAX_SPLIT_UPDATES && total <= MAX_SPLIT_UPDATE_BYTES
          ? pieces
          : null
      this.pieces.set(part, usable)
      this.refreshSaveState()
    }
    return this.pieces.get(part) ?? null
  }

  private refreshSaveState(): void {
    const unacked = this.unackedParts()
    for (const [part, timer] of this.unsavedTimers) {
      if (unacked.includes(part)) continue
      clearTimeout(timer)
      this.unsavedTimers.delete(part)
    }
    const large = unacked.filter((part) => part.length > MAX_UPDATE_BYTES)
    // From when it is owed, not from a failure: it may not even be sent.
    for (const part of large) if (!this.unsaved.has(part)) this.warnIfStillUnsaved(part)
    const stuck = large.some(
      (part) =>
        this.unsaved.has(part) ||
        part.length > MAX_SPLIT_UPDATE_BYTES ||
        this.pieces.get(part) === null,
    )
    const state = stuck ? 'stuck' : large.length > 0 ? 'sending' : null
    if (state === this.saveState) return
    this.saveState = state
    this.emit('save-state')
  }

  // Drops the parts a save stored, wherever they sit by now. A frame in flight
  // with other parts still waits for its own receipt.
  private settleParts(stored: Uint8Array[]): void {
    const owed = (part: Uint8Array) => !stored.includes(part)
    this.queued = this.queued.filter(owed)
    if (this.inFlight) {
      this.inFlight.parts = this.inFlight.parts.filter(owed)
      if (this.inFlight.parts.length === 0) {
        this.clearAckTimer()
        this.inFlight = null
        this.retryAttempt = 0
      }
    }
    this.refreshSaveState()
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
    this.unsavedTimers.forEach((timer) => clearTimeout(timer))
    this.unsavedTimers.clear()
    this.clearAckTimer()
    this.clearRetryTimer()
  }

  private clearOutbox(): void {
    this.clearTimers()
    this.inFlight = null
    this.queued = []
    this.retryAttempt = 0
    this.refusedPart = null
    this.refreshSaveState()
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
      this.seedRequested = true
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
    if (this.discarded) return
    this.discarded = true
    this.stopSeedWait()
    this.clearOutbox()
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

  private flush(type: 'sync-reply' | 'update' = 'update'): void {
    if (
      this.destroyed ||
      this.discarded ||
      !this.canWrite ||
      !this.synced ||
      this.inFlight ||
      this.retryTimer ||
      this.queued.length === 0
    ) {
      return
    }
    const [parts] = packUpdates(this.queued)
    const oversized = parts[0].length > MAX_UPDATE_BYTES
    if (this.upload?.part === parts[0]) return
    if (this.refused() || !this.piecesOf(parts[0])) return
    this.queued = this.queued.slice(parts.length)
    this.updateSequence += 1
    const seq = this.updateSequence
    this.inFlight = { seq, parts }
    if (oversized) {
      this.startUpload(parts[0])
      return
    }
    this.send({
      type,
      update: toBase64(Y.mergeUpdates(parts)),
      seq,
      generation: this.generation,
      ...this.seedClaimParam(),
    })
    this.ackTimer = setTimeout(() => this.handleAckTimeout(seq), this.ackTimeoutMs)
  }

  private refused(): boolean {
    return this.refusedPart !== null && this.unackedParts().includes(this.refusedPart)
  }

  private refuse(part: Uint8Array): void {
    this.refusedPart = part
    this.unsaved.add(part)
    this.refreshSaveState()
  }

  /** Retry an edit refused on this connection once write access returns. */
  retryRefused(): void {
    if (!this.refused()) return
    this.refusedPart = null
    this.flush('update')
  }

  // No frame holds this part, so it goes over HTTP, whose answer is its receipt.
  private startUpload(part: Uint8Array): void {
    const upload = { part, abort: new AbortController() }
    this.upload = upload
    const deadline = setTimeout(() => upload.abort.abort(), this.uploadDeadlineMs(part.length))
    void this.save([part], undefined, upload.abort.signal).then(({ status, seedRefused }) => {
      clearTimeout(deadline)
      if (this.upload === upload) this.upload = null
      if (this.destroyed || this.discarded) return
      if (this.inFlight?.parts.includes(part)) this.requeueInFlight()
      // Saved, or given up with the rest of the outbox.
      if (!this.queued.includes(part)) {
        this.flush('update')
        return
      }
      // Aborted: whatever it answered, its connection is gone.
      const refused = status >= 400 && status < 500 && status !== 408 && status !== 429
      if (!refused || seedRefused || upload.abort.signal.aborted) {
        this.scheduleRetry()
      } else if (status === 409) {
        // As for a frame refused as stale: the document was replaced.
        this.clearOutbox()
        this.emit('stale')
      } else {
        this.refuse(part)
        if (status === 423) this.emit('write-denied')
      }
    })
  }

  private warnIfStillUnsaved(part: Uint8Array): void {
    if (this.unsavedTimers.has(part)) return
    this.unsavedTimers.set(part, setTimeout(() => {
      this.unsavedTimers.delete(part)
      this.unsaved.add(part)
      this.refreshSaveState()
    }, this.uploadWarnMs))
  }

  private seedClaimParam(): { seed_claim?: string } {
    return this.seedClaim === null ? {} : { seed_claim: this.seedClaim }
  }

  private handleAckTimeout(seq: number): void {
    this.ackTimer = null
    if (this.destroyed || !this.inFlight || this.inFlight.seq !== seq) return
    this.requeueInFlight()
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.destroyed || !this.synced || this.retryTimer || this.queued.length === 0) return
    const exponent = Math.min(this.retryAttempt, 10)
    const delayMs = Math.min(this.retryBaseMs * 2 ** exponent, this.retryMaxMs)
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.flush('update')
    }, delayMs)
  }

  /**
   * Persist unacked outbox parts up to the first that cannot be sent or is
   * already uploading (and none while an edit is refused), over HTTP so
   * discrete edits or an immediate navigation/unload survive ActionCable
   * teardown: `keepalive` when the body fits what browsers allow, ordinary
   * otherwise.
   */
  persistCurrentState = (snapshot?: DurableSnapshotPayload): void => {
    this.persistUnacked(snapshot, false)
  }

  private persistUnacked(snapshot?: DurableSnapshotPayload, includeUploading = false): void {
    if (!this.canWrite || this.discarded) return
    const unacked = this.unackedParts()
    const uploading =
      !includeUploading && this.upload && !this.upload.abort.signal.aborted
        ? this.upload.part
        : null
    const parts: Uint8Array[] = []
    const allPieces: Uint8Array[] = []
    let totalBytes = 0
    if (!this.refused()) {
      for (const part of unacked) {
        if (part === uploading) break
        const partPieces = this.piecesOf(part)
        if (!partPieces) break
        const nextPieces = [...allPieces, ...partPieces]
        const nextBytes = totalBytes + partPieces.reduce((sum, piece) => sum + piece.length, 0)
        if (
          parts.length > 0 &&
          (nextBytes > MAX_SPLIT_UPDATE_BYTES || packUpdates(nextPieces).length > MAX_SPLIT_UPDATES)
        ) {
          break
        }
        parts.push(part)
        allPieces.push(...partPieces)
        totalBytes = nextBytes
      }
    }
    const withheld = parts.length < unacked.length
    if (parts.length > 0 || (snapshot && !withheld)) void this.save(parts, withheld ? undefined : snapshot)
  }

  // Status 0 when no answer came.
  private save(
    parts: Uint8Array[],
    snapshot?: DurableSnapshotPayload,
    signal?: AbortSignal,
  ): Promise<SaveAnswer> {
    const pending = parts.length > 0 ? Y.mergeUpdates(parts) : EMPTY_UPDATE
    const sentClaim = this.seedClaim
    parts.forEach((part) => this.carriedBySave.add(part))

    const updatePayload = {
      // The server stores what it gets in `updates` together or not at all.
      ...(pending.length > MAX_UPDATE_BYTES
        ? {
            updates: packUpdates(parts.flatMap((part) => this.piecesOf(part) ?? [])).map((group) =>
              toBase64(Y.mergeUpdates(group)),
            ),
          }
        : { update: toBase64(pending) }),
      cid: this.clientId,
      // Same staleness guard as flush(): this beforeunload/keepalive
      // fallback merges through the same YjsPersistence.merge_updates
      // as SyncChannel, so it always carries content_generation (initialized
      // from page props even before the WebSocket handshake completes).
      generation: this.generation,
      ...this.seedClaimParam(),
    }
    let body = JSON.stringify(updatePayload)
    if (snapshot) {
      // Large docs still get durable CRDT state (and therefore correct reload
      // behavior); their derived source snapshot continues through the normal
      // debounce.
      const completeBody = JSON.stringify({ ...updatePayload, ...snapshot })
      const completeBytes = byteLength(completeBody)
      if (completeBytes <= MAX_SAVE_WITH_SNAPSHOT_BYTES && fitsKeepalive(completeBytes)) {
        body = completeBody
      }
    }

    // A save with no room for keepalive would never leave the browser, so it
    // goes as an ordinary request, which only lasts as long as the page.
    const bodyBytes = byteLength(body)
    const keepalive = fitsKeepalive(bodyBytes)
    if (keepalive) keepaliveBytesInFlight += bodyBytes

    return fetch(`/d/${this.slug}/sync_update`, {
      method: 'POST',
      headers: jsonHeaders(),
      body,
      keepalive,
      signal,
    })
      .then(async (response) => {
        let seedRefused = false
        if (response.status === 409) {
          const refusal = (await response.json().catch(() => null)) as { seed_refused?: boolean } | null
          // Before the handshake this client may still be granted the claim
          // anew, so the handshake decides.
          const current = this.synced && this.seedClaim === sentClaim
          seedRefused = refusal?.seed_refused === true
          if (seedRefused && current && !this.destroyed) this.discardLocalSeed()
        }
        if (!response.ok) {
          console.warn('CableProvider: durable sync failed', new Error(`HTTP ${response.status}`))
          return { status: response.status, seedRefused }
        }
        if (this.destroyed || this.discarded) return { status: response.status, seedRefused }
        if (parts.length > 0) this.settleSeedClaim()
        this.settleParts(parts)
        this.flush('update')
        return { status: response.status, seedRefused }
      })
      .catch((error) => {
        console.warn('CableProvider: durable sync failed', error)
        return { status: 0, seedRefused: false }
      })
      .finally(() => {
        if (keepalive) keepaliveBytesInFlight -= bodyBytes
      })
  }

  private handleReceived(data: SyncMessage): void {
    if (data.cid === this.clientId || this.discarded) return

    switch (data.type) {
      case 'sync': {
        const answersSeedRequest = this.seedRequested
        this.seedRequested = false
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
        if (this.seedClaim !== null && data.sv) {
          const stateVector = Y.decodeStateVector(fromBase64(data.sv))
          if (stateVector.size > 0 && !this.serverHoldsOwnSeed(stateVector)) {
            this.discardLocalSeed()
            break
          }
          if (stateVector.size > 0) this.settleSeedClaim()
        }
        if (this.localSeed) {
          const hasContent = Boolean(data.update) && !isEmptyUpdate(fromBase64(data.update!))
          if ((data.seed || data.seed_pending) && !hasContent) this.completeSync()
          else this.discardLocalSeed()
          break
        }
        // A late answer to a seed-request, not a new subscription: the
        // outbox and its sequence are live and must not be reset.
        if (this.synced && answersSeedRequest) {
          if (data.seed) this.takeOrDeclineSeedClaim(data.seed_claim, this.seedClaim !== null)
          if (data.update) Y.applyUpdate(this.doc, fromBase64(data.update), this)
          break
        }
        // Still synced means a half-open socket was replaced without
        // `disconnected`. Numbering continues then, so a receipt for the old
        // send cannot settle the new one.
        if (this.synced) this.synced = false
        else this.updateSequence = 0
        // Apply server's delta or full state (empty string on checksum match);
        // any unacked local edits stay in the outbox and flush immediately once synced.
        if (data.update) {
          Y.applyUpdate(this.doc, fromBase64(data.update), this)
        }
        this.serverChecksum = data.checksum ?? null
        this.clearRetryTimer()
        this.requeueInFlight()
        this.refusedPart = null
        this.retryAttempt = 0
        if (typeof data.generation === 'number') this.generation = data.generation
        const seedContent = data.seed_content
        const localDocEmpty = this.doc.store.clients.size === 0
        if (data.seed && !this.canWrite && localDocEmpty) {
          // Only a writer is granted the claim. This session cannot use it, so
          // it goes back for the one the page opens with its current access.
          this.send({ type: 'seed-decline' })
          this.waitForSeed()
          this.emit('access-changed')
          break
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
          this.waitForSeed()
          // A pending handshake carries the seed only for those who cannot write.
          const serverAllowsWrites = !seedContent
          if (this.canWrite !== serverAllowsWrites) this.emit('access-changed')
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
        this.refreshSaveState()
        this.settleSeedClaim()
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
          const update = data.updates
            ? Y.mergeUpdates(data.updates.map(fromBase64))
            : fromBase64(data.update!)
          if (this.localSeed) {
            if (!isEmptyUpdate(update)) this.discardLocalSeed()
            break
          }
          if (this.seedClaim !== null) {
            this.heldUpdates.push(update)
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
        if (this.seedClaim !== null && (data.stale || data.reason === 'stale')) {
          this.discardLocalSeed()
          break
        }
        if (!data.stale && data.reason !== 'stale' && this.saveState !== null) {
          // Holding a large edit: kept readable, as when its upload is refused.
          this.requeueInFlight()
          const large = this.queued.find((part) => part.length > MAX_UPDATE_BYTES)
          if (large) this.refuse(large)
          this.emit('write-denied')
          break
        }
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
    this.refreshSaveState()
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

  private handleUnload = (event?: BeforeUnloadEvent): void => {
    // Too large to outlive the page, so ask before it goes.
    const unacked = this.unackedParts().reduce((bytes, part) => bytes + part.length, 0)
    const ask = event !== undefined && (this.saveState !== null || unacked > MAX_UPDATE_BYTES)
    if (ask) event.preventDefault()
    // Whoever stays is still here.
    else removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload')
    if (this.inFlight || this.queued.length > 0) {
      this.persistUnacked(undefined, true)
    }
  }
}
