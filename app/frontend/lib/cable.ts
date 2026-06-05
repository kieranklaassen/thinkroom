import { createConsumer, type Consumer } from '@rails/actioncable'

let consumer: Consumer | null = null

/** One WebSocket per tab — Yjs sync and meta events share it. */
export function getConsumer(): Consumer {
  consumer ??= createConsumer()
  return consumer
}
