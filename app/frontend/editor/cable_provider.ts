import type { Consumer, Subscription } from '@rails/actioncable'
import { getConsumer } from '../lib/cable'
import { csrfToken } from '../lib/csrf'
import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'

type SyncMessage = {
  type: 'sync' | 'sync-reply' | 'update' | 'awareness' | 'awareness-query' | 'write-denied'
  update?: string
  sv?: string
  /** Server content generation. Bumped by an owner replace_content!; echoed on
   *  outgoing frames so the server can drop ones from a superseded generation. */
  epoch?: number
  seed?: boolean
  content_format?: 'markdown' | 'html'
  seed_content?: string
  seed_markdown?: string
  seed_author_kind?: string | null
  seed_author_name?: string | null
  cid?: string
  seq?: number
}

export interface DurableSnapshotPayload {
  content: string
  spans: unknown[]
  state_vector: string
}

const toBase64 = (u8: Uint8Array): string => {
  let binary = ''
  u8.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

const fromBase64 = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/**
 * Yjs provider over Rails ActionCable. Speaks the SyncChannel protocol:
 * the server transmits full state + its state vector on subscribe; we apply it,
 * reply with everything the server is missing (sync step 2), and from then on
 * relay incremental updates both ways. Awareness piggybacks on the same
 * subscription, relay-only. Reconnects re-run the handshake automatically
 * because ActionCable re-fires `connected` -> server re-transmits sync.
 */
export class CableProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly clientId = crypto.randomUUID()
  synced = false
  // The server content generation this client last synced at. Stamped on every
  // outgoing frame so the server drops frames produced before an owner
  // replace_content! reset (which would otherwise resurrect the old CRDT state).
  private serverEpoch = 0
  // True once any sync has landed; unlike `synced` it survives disconnects, so a
  // reconnect can tell "first handshake" from "re-handshake at a new generation".
  private hasSynced = false
  seedContent: string | null = null
  seedFormat: 'markdown' | 'html' = 'markdown'
  // Seed authorship rides alongside seedContent with the same one-shot
  // consume semantics: the editor reads and nulls all three together so a
  // remount can never re-attribute.
  seedAuthorKind: string | null = null
  seedAuthorName: string | null = null

  private subscription: Subscription
  private consumer: Consumer
  private listeners = new Map<string, Set<(...args: never[]) => void>>()
  private destroyed = false
  private updateSequence = 0
  private serverStateVector: Uint8Array | null = null
  private readonly slug: string
  private readonly canWrite: boolean

  constructor(
    doc: Y.Doc,
    slug: string,
    options?: { consumer?: Consumer; canWrite?: boolean; connectionIdentity?: string },
  ) {
    this.doc = doc
    this.slug = slug
    this.canWrite = options?.canWrite ?? true
    this.awareness = new Awareness(doc)
    this.consumer = options?.consumer ?? getConsumer(options?.connectionIdentity)

    this.subscription = this.consumer.subscriptions.create(
      { channel: 'SyncChannel', slug },
      {
        received: (data: SyncMessage) => this.handleReceived(data),
        disconnected: () => {
          this.synced = false
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
          this.emit('rejected')
        },
      },
    )

    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
    window.addEventListener('beforeunload', this.handleUnload)
  }

  on(event: 'synced' | 'seed' | 'rejected' | 'write-denied' | 'superseded', handler: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler as never)
  }

  off(event: 'synced' | 'seed' | 'rejected' | 'write-denied' | 'superseded', handler: () => void): void {
    this.listeners.get(event)?.delete(handler as never)
  }

  // The generation derived snapshots must be stamped with, so the server drops
  // a snapshot produced before an owner replace_content! reset.
  get contentEpoch(): number {
    return this.serverEpoch
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.handleUnload()
    window.removeEventListener('beforeunload', this.handleUnload)
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.subscription.unsubscribe()
    this.awareness.destroy()
  }

  private emit(event: string): void {
    // Isolate listener failures: one stale handler (e.g. bound to a
    // destroyed editor) must never prevent the others from running.
    this.listeners.get(event)?.forEach((handler) => {
      try {
        ;(handler as () => void)()
      } catch (error) {
        console.error(`CableProvider ${event} listener failed`, error)
      }
    })
  }

  private send(payload: Record<string, unknown>): void {
    this.subscription.send({ ...payload, cid: this.clientId })
  }

  private sendUpdate(type: 'sync-reply' | 'update', update: Uint8Array): void {
    this.updateSequence += 1
    this.send({ type, update: toBase64(update), seq: this.updateSequence, epoch: this.serverEpoch })
  }

  /**
   * Persist everything this client has observed beyond the server vector from
   * its last handshake. The update is idempotent, and `keepalive` lets the
   * request finish when a click is immediately followed by navigation.
   */
  persistCurrentState = (snapshot: DurableSnapshotPayload): void => {
    if (!this.canWrite) return
    const update = this.serverStateVector
      ? Y.encodeStateAsUpdate(this.doc, this.serverStateVector)
      : Y.encodeStateAsUpdate(this.doc)
    const persistedVector = Y.encodeStateVector(this.doc)

    const updatePayload = { update: toBase64(update), cid: this.clientId, epoch: this.serverEpoch }
    const completePayload = { ...updatePayload, ...snapshot }
    const completeBody = JSON.stringify(completePayload)
    // Browsers cap keepalive request bodies at roughly 64 KiB. Large docs
    // still get durable CRDT state (and therefore correct reload behavior);
    // their derived source snapshot continues through the normal debounce.
    const body =
      new TextEncoder().encode(completeBody).byteLength <= 60 * 1024
        ? completeBody
        : JSON.stringify(updatePayload)

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
        this.serverStateVector = persistedVector
      })
      .catch((error) => console.warn('CableProvider: durable sync failed', error))
  }

  private handleReceived(data: SyncMessage): void {
    if (data.cid === this.clientId) return

    switch (data.type) {
      case 'sync': {
        const incomingEpoch = data.epoch ?? 0
        // A reconnect that lands on a newer generation means the source was
        // replaced (replace_content!) while we held the old one — possibly
        // while we were offline and missed the content_reset signal. Replying
        // with our stale state would resurrect the replaced content, so skip the
        // handshake and recover by reloading into the new generation.
        if (this.hasSynced && incomingEpoch > this.serverEpoch) {
          this.serverEpoch = incomingEpoch
          this.emit('superseded')
          break
        }
        this.serverEpoch = incomingEpoch
        this.hasSynced = true
        // Server's full state, then reply with what it's missing (sync step 2).
        Y.applyUpdate(this.doc, fromBase64(data.update!), this)
        const serverVector = fromBase64(data.sv!)
        this.serverStateVector = serverVector
        this.updateSequence = 0
        if (this.canWrite) {
          this.sendUpdate('sync-reply', Y.encodeStateAsUpdate(this.doc, serverVector))
        }
        const seedContent = data.seed_content ?? data.seed_markdown
        if (data.seed && seedContent) {
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
        }
        this.synced = true
        this.emit('synced')
        // Announce ourselves and ask existing peers to re-announce.
        this.broadcastAwareness()
        this.send({ type: 'awareness-query' })
        break
      }
      case 'update':
      case 'sync-reply':
        try {
          Y.applyUpdate(this.doc, fromBase64(data.update!), this)
        } catch (error) {
          // A malformed frame from a peer must not break this client's
          // sync handler; the doc itself is untouched by a failed apply.
          console.warn('CableProvider: dropped malformed update', error)
        }
        break
      case 'awareness':
        applyAwarenessUpdate(this.awareness, fromBase64(data.update!), this)
        break
      case 'awareness-query':
        this.broadcastAwareness()
        break
      case 'write-denied':
        this.emit('write-denied')
        break
    }
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Updates we applied from the wire carry `this` as origin — don't echo them.
    if (origin === this || !this.synced || !this.canWrite) return
    this.sendUpdate('update', update)
  }

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this) return
    const changed = added.concat(updated, removed)
    if (!this.subscription || changed.length === 0) return
    this.send({
      type: 'awareness',
      update: toBase64(encodeAwarenessUpdate(this.awareness, changed)),
    })
  }

  private broadcastAwareness(): void {
    if (this.awareness.getLocalState() !== null) {
      this.send({
        type: 'awareness',
        update: toBase64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])),
      })
    }
  }

  private handleUnload = (): void => {
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload')
  }
}
