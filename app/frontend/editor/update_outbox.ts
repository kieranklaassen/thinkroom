import * as Y from 'yjs'
import { MAX_UPDATE_BYTES } from './sync_wire'

export type UpdateFrameType = 'sync-reply' | 'update'

interface UpdateOutboxOptions {
  ackTimeoutMs: number
  retryBaseMs: number
  retryMaxMs: number
  /** Whether a frame may leave now. Edits wait in the outbox while not. */
  canSend: () => boolean
  transmit: (type: UpdateFrameType, seq: number, update: Uint8Array) => void
  /** Whether an HTTP save under way carries this part. */
  isInSave: (part: Uint8Array) => boolean
}

// The leading parts that merge into one update the server takes.
const partsThatFit = (parts: Uint8Array[]): Uint8Array[] => {
  let bytes = 0
  const end = parts.findIndex((part) => (bytes += part.length) > MAX_UPDATE_BYTES)
  return end === -1 ? parts : parts.slice(0, end)
}

/**
 * The local edits the server has not confirmed. At most one frame awaits its
 * receipt at a time; edits made while offline, awaiting a receipt or backing
 * off accumulate in `queued` via `Y.mergeUpdates`. Exact unacked state
 * (`inFlight` + `queued`) tells us deterministically whether local edits owe a
 * flush on reconnect or unload: a read-only open has neither and sends nothing.
 *
 * Both hold parts rather than one update: a part an in-flight HTTP save
 * carries is never merged with later edits, so the save's success settles
 * that part alone.
 */
export class UpdateOutbox {
  inFlight: { seq: number; parts: Uint8Array[] } | null = null
  queued: Uint8Array[] = []
  private readonly options: UpdateOutboxOptions
  private sequence = 0
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0

  constructor(options: UpdateOutboxOptions) {
    this.options = options
  }

  enqueue(update: Uint8Array): void {
    const last = this.queued[this.queued.length - 1]
    const fits = last && last.length + update.length <= MAX_UPDATE_BYTES
    if (fits && !this.options.isInSave(last)) {
      this.queued[this.queued.length - 1] = Y.mergeUpdates([last, update])
    } else {
      this.queued.push(update)
    }
  }

  flush(type: UpdateFrameType = 'update'): void {
    if (!this.options.canSend() || this.inFlight || this.retryTimer || this.queued.length === 0) {
      return
    }
    const parts = partsThatFit(this.queued)
    this.queued = this.queued.slice(parts.length)
    this.sequence += 1
    this.inFlight = { seq: this.sequence, parts }
    this.options.transmit(type, this.sequence, Y.mergeUpdates(parts))
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null
      this.retryLater()
    }, this.options.ackTimeoutMs)
  }

  /** The leading unconfirmed parts, as many as the server takes in one update. */
  unackedParts(): Uint8Array[] {
    return partsThatFit([...(this.inFlight?.parts ?? []), ...this.queued])
  }

  awaitsReceipt(seq: number | undefined): boolean {
    return this.inFlight !== null && this.inFlight.seq === seq
  }

  /** The server answered for the frame in flight, so nothing of it is owed. */
  settleInFlight(): void {
    this.clearAckTimer()
    this.inFlight = null
    this.retryAttempt = 0
  }

  /** Drops the parts a save stored, wherever they sit by now. A frame in flight
   *  with other parts still waits for its own receipt. */
  settleParts(stored: Uint8Array[]): void {
    const owed = (part: Uint8Array) => !stored.includes(part)
    this.queued = this.queued.filter(owed)
    if (!this.inFlight) return
    this.inFlight.parts = this.inFlight.parts.filter(owed)
    if (this.inFlight.parts.length === 0) this.settleInFlight()
  }

  /** Puts the frame in flight back ahead of later edits and backs off. */
  retryLater(): void {
    this.requeueInFlight()
    if (!this.options.canSend() || this.retryTimer || this.queued.length === 0) return
    const { retryBaseMs, retryMaxMs } = this.options
    const delayMs = Math.min(retryBaseMs * 2 ** Math.min(this.retryAttempt, 10), retryMaxMs)
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.flush()
    }, delayMs)
  }

  /** The connection that would have answered is gone: everything unconfirmed
   *  waits for the next handshake. */
  suspend(): void {
    this.clearRetryTimer()
    this.requeueInFlight()
  }

  resetBackoff(): void {
    this.retryAttempt = 0
  }

  restartNumbering(): void {
    this.sequence = 0
  }

  stopTimers(): void {
    this.clearAckTimer()
    this.clearRetryTimer()
  }

  clear(): void {
    this.settleInFlight()
    this.clearRetryTimer()
    this.queued = []
  }

  private requeueInFlight(): void {
    this.clearAckTimer()
    if (!this.inFlight) return
    this.queued = [...this.inFlight.parts, ...this.queued]
    this.inFlight = null
  }

  private clearAckTimer(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer)
    this.ackTimer = null
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
