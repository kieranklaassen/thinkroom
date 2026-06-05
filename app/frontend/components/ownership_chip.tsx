import { useEffect, useState } from 'react'
import { router } from '@inertiajs/react'

export interface OwnershipPayload {
  claimed: boolean
  claimable: boolean
  owner_name: string | null
  yours: boolean
}

interface Props {
  slug: string
  ownership: OwnershipPayload
  claimerName: string
}

/**
 * Header chip for document ownership. Four states, all in the chrome-toggle
 * visual register — no modal, no dropdown:
 *   unclaimed + claimable  → "Claim" button (optimistic, scoped reload)
 *   yours                  → "Yours" badge; click expands inline to a
 *                            two-step Delete?/Keep confirm
 *   claimed by someone else → muted "Owned by ‹name›" text
 *   unclaimed + unclaimable → nothing (the demo doc)
 *
 * The badge renders the word "Yours", never the stored owner name — the
 * localStorage identity can drift after claiming, and echoing the old name
 * as if it were current would mislead.
 */
export function OwnershipChip({ slug, ownership, claimerName }: Props) {
  const [claimFailed, setClaimFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // A failed claim offers "Try again" for a beat, then settles back.
  useEffect(() => {
    if (!claimFailed) return
    const timer = setTimeout(() => setClaimFailed(false), 3000)
    return () => clearTimeout(timer)
  }, [claimFailed])

  if (ownership.yours) {
    if (confirming) {
      return (
        <span className="ownership-confirm">
          <button
            className="chrome-toggle ownership-delete"
            disabled={deleting}
            onClick={() => {
              setDeleting(true)
              router.delete(`/d/${slug}`)
            }}
          >
            {deleting ? 'Deleting…' : 'Delete?'}
          </button>
          <button
            className="chrome-toggle"
            disabled={deleting}
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </span>
      )
    }
    return (
      <button
        className="chrome-toggle"
        aria-pressed="true"
        title="You own this document — click to delete it"
        onClick={() => setConfirming(true)}
      >
        Yours
      </button>
    )
  }

  if (ownership.claimed) {
    return (
      <span className="ownership-owner" title="This document has been claimed">
        Owned by {ownership.owner_name}
      </span>
    )
  }

  if (!ownership.claimable) return null

  const claim = () => {
    setClaimFailed(false)
    router
      .optimistic((props: { ownership?: OwnershipPayload }) => ({
        ownership: { ...(props.ownership ?? ownership), claimed: true, yours: true },
      }))
      .post(
        `/d/${slug}/claim`,
        { name: claimerName },
        {
          preserveScroll: true,
          // Scoped like acceptSuggestion — the redirect-back must never
          // re-ship the document prop's embedded Yjs state.
          only: ['ownership', 'activities'],
          async: true,
          // A lost race arrives as an error + refreshed ownership prop; the
          // chip re-renders to "Owned by ‹winner›" on its own. "Try again"
          // only matters when the doc is still unclaimed (network blip).
          onError: () => setClaimFailed(true),
        },
      )
  }

  return (
    <button
      className="chrome-toggle"
      title="Claim this document to your browser — claiming lets you delete it"
      onClick={claim}
    >
      {claimFailed ? 'Try again' : 'Claim'}
    </button>
  )
}
