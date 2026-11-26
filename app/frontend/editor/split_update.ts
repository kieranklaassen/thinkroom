import * as Y from 'yjs'

type Struct = ReturnType<typeof Y.decodeUpdate>['structs'][number]
type Deletes = ReturnType<typeof Y.decodeUpdate>['ds']

const encodeStruct = (struct: Struct, offset: number): Uint8Array => {
  const encoder = new Y.UpdateEncoderV1()
  struct.write(encoder, offset)
  return encoder.toUint8Array()
}

const encodeDeletes = (deletes: Deletes): Uint8Array => {
  const encoder = new Y.UpdateEncoderV1()
  encoder.writeLen(deletes.clients.size)
  deletes.clients.forEach((ranges, client) => {
    encoder.writeClient(client)
    encoder.writeLen(ranges.length)
    for (const { clock, len } of ranges) {
      encoder.writeDsClock(clock)
      encoder.writeDsLen(len)
    }
  })
  return encoder.toUint8Array()
}

const concat = (arrays: Uint8Array[]): Uint8Array => {
  const joined = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0))
  let at = 0
  for (const array of arrays) {
    joined.set(array, at)
    at += array.length
  }
  return joined
}

// Struct and client counts, client id and first clock: at most 5 bytes for
// each count or id, 8 for the clock.
const HEADER_BYTES = 24
const NO_DELETES = Uint8Array.from([0])

/**
 * Splits one client's v1 update into updates of at most `limit` bytes, in clock
 * order. They are one edit and must be applied as one: y-prosemirror deletes a
 * half-built node that its schema does not allow.
 *
 * Null when it cannot be done: a single value over the limit, or structs of
 * several clients.
 */
export function splitUpdate(update: Uint8Array, limit: number): Uint8Array[] | null {
  const { structs, ds } = Y.decodeUpdate(update)
  if (structs.length === 0) return null
  const client = structs[0].id.client
  if (structs.some((struct) => struct.id.client !== client)) return null

  const deletes = encodeDeletes(ds)
  const pieces: Uint8Array[] = []
  let clock = 0
  let parts: Uint8Array[] = []
  let size = 0
  const trailer = () => (pieces.length === 0 ? deletes : NO_DELETES)
  const room = () => limit - HEADER_BYTES - trailer().length
  const add = (at: number, bytes: Uint8Array) => {
    if (parts.length === 0) clock = at
    parts.push(bytes)
    size += bytes.length
  }
  const close = () => {
    const header = new Y.UpdateEncoderV1()
    header.writeLen(1)
    header.writeLen(parts.length)
    header.writeClient(client)
    header.writeDsClock(clock)
    pieces.push(concat([header.toUint8Array(), ...parts, trailer()]))
    parts = []
    size = 0
  }

  for (const struct of structs) {
    let offset = 0
    let bytes = encodeStruct(struct, offset)
    while (size + bytes.length > room()) {
      if (parts.length > 0) {
        close()
        continue
      }
      if (!(struct instanceof Y.Item) || !(struct.content instanceof Y.ContentString)) return null
      const text = struct.content.str
      const utf8 = (from: string) => new TextEncoder().encode(from).length
      // The item without its text.
      const budget = room() - (bytes.length - utf8(text.slice(offset)))
      if (budget <= 0) return null
      let take = budget
      for (;;) {
        const length = utf8(text.slice(offset, offset + take))
        if (length <= budget) break
        take = Math.min(take - 1, Math.floor((take * budget) / length))
      }
      let end = offset + take
      if (end > offset && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1
      if (end <= offset) return null
      struct.content.str = text.slice(0, end)
      add(struct.id.clock + offset, encodeStruct(struct, offset))
      struct.content.str = text
      close()
      offset = end
      bytes = encodeStruct(struct, offset)
    }
    add(struct.id.clock + offset, bytes)
  }
  if (parts.length > 0) close()
  return pieces
}
