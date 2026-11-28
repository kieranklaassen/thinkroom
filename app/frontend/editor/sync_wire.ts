import type { CollaboratorKind } from '../types/payloads'

/** A frame of the SyncChannel protocol, as received. */
export type SyncMessage = {
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
}

// The largest update the server takes (YjsPersistence::MAX_UPDATE_BYTES).
export const MAX_UPDATE_BYTES = 2 * 1024 * 1024

// The exact v1 update carrying no structs and no deletes.
export const EMPTY_UPDATE = new Uint8Array([0, 0])

export const isEmptyUpdate = (update: Uint8Array): boolean =>
  update.length === EMPTY_UPDATE.length && update.every((byte, i) => byte === EMPTY_UPDATE[i])

export const toBase64 = (u8: Uint8Array): string => {
  let binary = ''
  u8.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export const fromBase64 = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
