import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from 'y-protocols/awareness'
import { fromBase64, toBase64 } from './sync_wire'

const THROTTLE_MS = 100

interface AwarenessRelayOptions {
  awareness: Awareness
  send: (frame: Record<string, unknown>) => void
  isSynced: () => boolean
  /** Origin of changes that came from the channel, which are not sent back. */
  channelOrigin: unknown
}

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] }

/** Presence over the channel: local changes out, at most one per throttle
 *  window, and peers' changes in. */
export class AwarenessRelay {
  private readonly options: AwarenessRelayOptions
  private pending = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastSentAt = 0

  constructor(options: AwarenessRelayOptions) {
    this.options = options
  }

  handleChange = ({ added, updated, removed }: AwarenessChange, origin: unknown): void => {
    const { channelOrigin, isSynced } = this.options
    if (origin === channelOrigin || !isSynced()) return
    if (![...added, ...updated, ...removed].includes(this.localId)) return

    this.pending = true
    if (origin === 'unload' || removed.includes(this.localId)) {
      this.flush()
      return
    }
    if (this.timer !== null) return
    const elapsed = Date.now() - this.lastSentAt
    if (elapsed >= THROTTLE_MS) this.flush()
    else this.timer = setTimeout(() => this.flush(), Math.max(0, THROTTLE_MS - elapsed))
  }

  /** Sends the local state, changed or not. */
  announce(): void {
    if (this.options.awareness.getLocalState() === null) return
    this.pending = true
    this.flush()
  }

  /** Sends a waiting change now. */
  flush(): void {
    const { awareness, send } = this.options
    const pending = this.pending
    this.cancel()
    if (!pending || !awareness.meta.has(this.localId)) return
    this.lastSentAt = Date.now()
    send({
      type: 'awareness',
      client_id: this.localId,
      update: toBase64(encodeAwarenessUpdate(awareness, [this.localId])),
    })
  }

  /** Drops a waiting change. */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = false
  }

  receive(update: string): void {
    const { awareness, channelOrigin } = this.options
    try {
      applyAwarenessUpdate(awareness, fromBase64(update), channelOrigin)
    } catch (error) {
      console.warn('CableProvider: dropped malformed awareness update', error)
    }
  }

  dropPeer(clientId: number): void {
    if (clientId !== this.localId) this.remove([clientId])
  }

  dropAllPeers(): void {
    const { awareness } = this.options
    const peers = [...awareness.getStates().keys()].filter((id) => id !== this.localId)
    if (peers.length > 0) this.remove(peers)
  }

  leave(): void {
    removeAwarenessStates(this.options.awareness, [this.localId], 'unload')
  }

  // Read each time: Yjs gives a doc a new id when another client uses the same one.
  private get localId(): number {
    return this.options.awareness.doc.clientID
  }

  private remove(clientIds: number[]): void {
    removeAwarenessStates(this.options.awareness, clientIds, this.options.channelOrigin)
  }
}
