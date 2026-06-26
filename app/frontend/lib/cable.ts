import { createConsumer, type Consumer } from '@rails/actioncable'

let consumer: Consumer | null = null
let consumerIdentity: string | null = null

/** One WebSocket per tab — Yjs sync and meta events share it. */
export function getConsumer(identity = 'guest'): Consumer {
  if (consumer && consumerIdentity !== identity) {
    consumer.disconnect()
    consumer = null
  }
  consumerIdentity = identity
  consumer ??= createConsumer()
  return consumer
}
