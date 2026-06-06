import { useState } from 'react'
import { useClaim } from '../lib/use_claim'
import { getStoredFlag, setStoredFlag } from '../lib/local_storage'
import type { OwnershipPayload } from './ownership_chip'

interface Props {
  slug: string
  ownership: OwnershipPayload
  claimerName: string
}

const dismissKey = (slug: string) => `pruf:claim-banner:${slug}`

/**
 * Prominent claim CTA for unclaimed claimable docs — the primary claim
 * surface (the header menu keeps a fallback item). The per-slug dismiss
 * flag gates ONLY this banner element: ownership transitions still ride
 * the `:ownership` broadcast and the header re-renders to "Owned by ‹name›"
 * regardless of the stored flag, so a dismissed visitor is never offered
 * a doomed claim.
 */
export function ClaimBanner({ slug, ownership, claimerName }: Props) {
  const [dismissed, setDismissed] = useState(() => getStoredFlag(dismissKey(slug), false))
  const { claim, claiming, claimFailed } = useClaim(slug, claimerName, {
    only: ['ownership', 'activities'],
    optimistic: (props: { ownership?: OwnershipPayload }) => ({
      ownership: { ...(props.ownership ?? ownership), claimed: true, yours: true },
    }),
  })

  // claimable goes false the moment anyone claims (broadcast → scoped
  // reload) — the banner unmounts for every viewer without local wiring.
  if (!ownership.claimable || dismissed) return null

  return (
    <div className="claim-banner" role="region" aria-label="Claim this document">
      <span className="claim-banner-text">
        This doc belongs to no one yet — claim it to your account to manage it.
      </span>
      <span className="claim-banner-actions">
        <button className="btn btn-primary claim-banner-claim" disabled={claiming} onClick={claim}>
          {claimFailed ? 'Try again' : claiming ? 'Claiming…' : 'Claim this doc'}
        </button>
        <button
          className="claim-banner-dismiss"
          aria-label="Dismiss"
          title="Dismiss — you can still claim from the header menu"
          onClick={() => {
            setStoredFlag(dismissKey(slug), true)
            setDismissed(true)
          }}
        >
          ×
        </button>
      </span>
    </div>
  )
}
