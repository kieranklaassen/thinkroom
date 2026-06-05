import { useEffect } from 'react'
import { router } from '@inertiajs/react'
import { getConsumer } from './cable'

/**
 * Subscribes to DocumentMetaChannel and answers each event with a debounced
 * partial Inertia reload of just that prop — cable signals, controller stays
 * the source of truth.
 */
export function useMetaChannel(slug: string): void {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const subscription = getConsumer().subscriptions.create(
      { channel: 'DocumentMetaChannel', slug },
      {
        received: ({ event }: { event: string }) => {
          const existing = timers.get(event)
          if (existing) clearTimeout(existing)
          timers.set(
            event,
            setTimeout(() => {
              // async: a background reload must never cancel (and roll back)
              // an in-flight optimistic mutation like accepting a suggestion.
              router.reload({ only: [event], async: true })
            }, 150),
          )
        },
      },
    )

    return () => {
      subscription.unsubscribe()
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [slug])
}
