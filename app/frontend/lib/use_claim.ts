import { useEffect, useRef, useState } from 'react'
import { router } from '@inertiajs/react'

interface UseClaimOptions {
  /** Inertia props to reload on settle — page-specific (e.g. ['ownership',
   *  'activities'] on the doc page, ['yours', 'recent'] on the index). */
  only: string[]
  /** Optional optimistic-props updater applied before the POST. */
  optimistic?: (props: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Shared claim primitive for every claim surface (index row, doc banner,
 * header menu item). Owns the POST, the synchronous in-flight guard (refs
 * because state commits a frame too late for Enter-bounce/double-tap), and
 * the silent race handling: a lost race arrives as an Inertia error plus a
 * refreshed ownership prop — the UI re-renders to the winner on its own, no
 * error modal. `claimFailed` only matters for genuine network blips and
 * settles back after a beat.
 */
export function useClaim(slug: string, claimerName: string, options: UseClaimOptions) {
  const [claimFailed, setClaimFailed] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    if (!claimFailed) return
    const timer = setTimeout(() => setClaimFailed(false), 3000)
    return () => clearTimeout(timer)
  }, [claimFailed])

  const claim = () => {
    if (inFlight.current) return
    inFlight.current = true
    setClaiming(true)
    setClaimFailed(false)
    const r = options.optimistic ? router.optimistic(options.optimistic) : router
    r.post(
      `/d/${slug}/claim`,
      { name: claimerName },
      {
        preserveScroll: true,
        only: options.only,
        async: true,
        onError: () => setClaimFailed(true),
        onFinish: () => {
          inFlight.current = false
          setClaiming(false)
        },
      },
    )
  }

  return { claim, claiming, claimFailed }
}
