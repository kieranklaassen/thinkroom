import { useEffect } from 'react'
import { router } from '@inertiajs/react'
import { getConsumer } from './cable'

/**
 * Subscribes to DocumentMetaChannel and answers events with a debounced
 * partial Inertia reload — cable signals, controller stays the source of
 * truth. Events landing within the window batch into ONE reload (a single
 * action often broadcasts several, e.g. suggestions + activities), so the
 * server sees one request instead of a concurrent burst.
 */
export function useMetaChannel(slug: string): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const pending = new Set<string>()
    const subscription = getConsumer().subscriptions.create(
      { channel: 'DocumentMetaChannel', slug },
      {
        received: ({ event }: { event: string }) => {
          pending.add(event)
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            const only = [...pending]
            pending.clear()
            // async: a background reload must never cancel (and roll back)
            // an in-flight optimistic mutation like accepting a suggestion.
            router.reload({ only, async: true })
          }, 150)
        },
      },
    )

    return () => {
      subscription.unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [slug])
}
