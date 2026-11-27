import { useRef, useState } from 'react'
import { router } from '@inertiajs/react'
import { useClaim } from '../lib/use_claim'
import type { OwnershipPayload } from '../types/payloads'

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
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Once the document is yours, whether claimed here, in the banner or in another
  // tab, a message from before no longer holds.
  const [wasYours, setWasYours] = useState(ownership.yours)
  if (ownership.yours !== wasYours) {
    setWasYours(ownership.yours)
    if (ownership.yours) setDeleteError(null)
  }
  // Ref guards double-fires synchronously — state updates only take effect
  // after the next render commit, leaving a same-frame window for a second
  // click (Enter bounce, mobile double-tap) to dispatch a duplicate request.
  const deleteInFlight = useRef(false)

  // Shared claim primitive — same hook as the index rows and claim banner.
  const { claim, claimFailed } = useClaim(slug, claimerName, {
    // Scoped like acceptSuggestion — the redirect-back must never re-ship
    // the document prop's embedded Yjs state.
    only: ['ownership', 'activities'],
    optimistic: (props: { ownership?: OwnershipPayload }) => ({
      ownership: { ...(props.ownership ?? ownership), claimed: true, yours: true },
    }),
  })

  // A refusal usually comes with another ownership state, so the message goes
  // with every one of them.
  const refusal = deleteError && (
    <span className="header-menu-access-error" role="alert">
      {deleteError}
    </span>
  )

  if (ownership.yours) {
    if (confirming) {
      return (
        <span className="ownership-confirm">
          <button
            className="chrome-toggle ownership-delete"
            disabled={deleting}
            onClick={() => {
              if (deleteInFlight.current) return
              deleteInFlight.current = true
              setDeleting(true)
              setDeleteError(null)
              router.delete(`/d/${slug}`, {
                // Success leaves for home, another component, which is sent
                // whole. A refusal comes back to this page: scoped, it keeps
                // the open editor instead of loading the page again.
                only: ['ownership', 'activities'],
                preserveScroll: 'errors',
                onError: (errors) => {
                  setDeleteError(String(errors.document ?? 'Delete failed — please try again'))
                },
                onNetworkError: () => {
                  setDeleteError('Connection lost. This document may already be deleted.')
                  // Handled here; otherwise the visit rejects with no one to catch it.
                  return false
                },
                onFinish: () => {
                  deleteInFlight.current = false
                  setDeleting(false)
                  setConfirming(false)
                },
              })
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
      <>
        <button
          className="chrome-toggle"
          aria-pressed="true"
          title="You own this document — click to delete it"
          onClick={() => setConfirming(true)}
        >
          Yours — delete…
        </button>
        {refusal}
      </>
    )
  }

  if (ownership.claimed) {
    return (
      <>
        <span className="ownership-owner" title="This document has been claimed">
          Owned by {ownership.owner_name}
        </span>
        {refusal}
      </>
    )
  }

  if (!ownership.claimable) return refusal

  return (
    <>
      <button
        className="chrome-toggle"
        title="Claim this document to your browser — claiming lets you delete it"
        onClick={claim}
      >
        {claimFailed ? 'Claim failed — try again' : 'Claim this doc'}
      </button>
      {refusal}
    </>
  )
}
