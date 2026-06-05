import type { Consumer, Subscription } from '@rails/actioncable'
import { getConsumer } from '../lib/cable'
import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'

type SyncMessage = {
  type: 'sync' | 'sync-reply' | 'update' | 'awareness' | 'awareness-query'
  update?: string
  sv?: string
  seed?: boolean
  seed_markdown?: string
  cid?: string
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
  seedMarkdown: string | null = null

  private subscription: Subscription
  private consumer: Consumer
  private listeners = new Map<string, Set<(...args: never[]) => void>>()
  private destroyed = false

  constructor(doc: Y.Doc, slug: string, consumer?: Consumer) {
    this.doc = doc
    this.awareness = new Awareness(doc)
    this.consumer = consumer ?? getConsumer()

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
      },
    )

    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
    window.addEventListener('beforeunload', this.handleUnload)
  }

  on(event: 'synced' | 'seed', handler: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler as never)
  }

  off(event: 'synced' | 'seed', handler: () => void): void {
    this.listeners.get(event)?.delete(handler as never)
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

  private handleReceived(data: SyncMessage): void {
    if (data.cid === this.clientId) return

    switch (data.type) {
      case 'sync': {
        // Server's full state, then reply with what it's missing (sync step 2).
        Y.applyUpdate(this.doc, fromBase64(data.update!), this)
        const serverVector = fromBase64(data.sv!)
        this.send({
          type: 'sync-reply',
          update: toBase64(Y.encodeStateAsUpdate(this.doc, serverVector)),
        })
        if (data.seed && data.seed_markdown) {
          this.seedMarkdown = data.seed_markdown
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
    }
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Updates we applied from the wire carry `this` as origin — don't echo them.
    if (origin === this || !this.synced) return
    this.send({ type: 'update', update: toBase64(update) })
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
