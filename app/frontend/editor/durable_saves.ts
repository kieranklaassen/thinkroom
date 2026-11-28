import * as Y from 'yjs'
import { jsonHeaders } from '../lib/csrf'
import { EMPTY_UPDATE, toBase64 } from './sync_wire'

// Browsers refuse a keepalive request that takes the total of the page's
// keepalive bodies in flight past 64 KiB.
const KEEPALIVE_LIMIT_BYTES = 64 * 1024
const MAX_SAVE_WITH_SNAPSHOT_BYTES = 60 * 1024
// Every provider on the page shares this.
let keepaliveBytesInFlight = 0

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength
const fitsKeepalive = (bytes: number): boolean =>
  keepaliveBytesInFlight + bytes <= KEEPALIVE_LIMIT_BYTES

interface DurableSave {
  parts: Uint8Array[]
  /** What identifies and guards the write, sent beside the update. */
  guard: Record<string, unknown>
  /** Left out when the body would not fit with it. */
  snapshot?: object
  /** The page may be going away: send only what no save under way will deliver. */
  unload: boolean
  onStored: () => void
  /** The server refused the write for its seed claim. Runs before the failure is logged. */
  onSeedRefused: () => void
}

/**
 * HTTP saves of unconfirmed edits, which survive an immediate navigation or
 * ActionCable teardown: `keepalive` when the body fits what browsers allow,
 * ordinary otherwise.
 */
export class DurableSaves {
  private readonly url: string
  private carried = new WeakMap<Uint8Array, { saves: number; keepalive: number }>()

  constructor(slug: string) {
    this.url = `/d/${slug}/sync_update`
  }

  /** Whether a save under way carries this part. */
  carries = (part: Uint8Array): boolean => this.carried.has(part)

  send({ parts, guard, snapshot, unload, onStored, onSeedRefused }: DurableSave): void {
    if (parts.length === 0 && !snapshot) return
    if (unload && parts.every((part) => (this.carried.get(part)?.keepalive ?? 0) > 0)) return

    const update = parts.length > 0 ? Y.mergeUpdates(parts) : EMPTY_UPDATE
    const payload = { update: toBase64(update), ...guard }
    let body = JSON.stringify(payload)
    if (snapshot) {
      // Large docs still get durable CRDT state (and therefore correct reload
      // behavior); their derived source snapshot continues through the normal
      // debounce.
      const completeBody = JSON.stringify({ ...payload, ...snapshot })
      const completeBytes = byteLength(completeBody)
      if (completeBytes <= MAX_SAVE_WITH_SNAPSHOT_BYTES && fitsKeepalive(completeBytes)) {
        body = completeBody
      }
    }

    // A save with no room for keepalive would never leave the browser, so it
    // goes as an ordinary request, which only lasts as long as the page.
    const bodyBytes = byteLength(body)
    const keepalive = fitsKeepalive(bodyBytes)
    if (unload && !keepalive && parts.every(this.carries)) return
    this.start(parts, keepalive, bodyBytes)

    void fetch(this.url, { method: 'POST', headers: jsonHeaders(), body, keepalive })
      .then(async (response) => {
        if (response.status === 409) {
          const refusal = (await response.json().catch(() => null)) as { seed_refused?: boolean } | null
          if (refusal?.seed_refused) onSeedRefused()
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        onStored()
      })
      .catch((error) => console.warn('CableProvider: durable sync failed', error))
      .finally(() => this.finish(parts, keepalive, bodyBytes))
  }

  private start(parts: Uint8Array[], keepalive: boolean, bodyBytes: number): void {
    if (keepalive) keepaliveBytesInFlight += bodyBytes
    for (const part of parts) {
      const counts = this.carried.get(part) ?? { saves: 0, keepalive: 0 }
      counts.saves += 1
      if (keepalive) counts.keepalive += 1
      this.carried.set(part, counts)
    }
  }

  private finish(parts: Uint8Array[], keepalive: boolean, bodyBytes: number): void {
    if (keepalive) keepaliveBytesInFlight -= bodyBytes
    for (const part of parts) {
      const counts = this.carried.get(part)
      if (!counts) continue
      counts.saves -= 1
      if (keepalive) counts.keepalive -= 1
      if (counts.saves <= 0) this.carried.delete(part)
    }
  }
}
