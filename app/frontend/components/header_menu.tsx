import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, router } from '@inertiajs/react'
import { useMediaQuery } from '../lib/use_media_query'
import { useDismissable } from '../lib/use_dismissable'
import { OwnershipChip, type OwnershipPayload } from './ownership_chip'
import { FeedbackButton } from './feedback_button'
import type { AccountPayload } from '../types/viewer'

interface Props {
  panelOpen: boolean
  onTogglePanel: () => void
  focusMode: boolean
  onToggleFocus: () => void
  slug: string
  ownership: OwnershipPayload
  claimerName: string
  account: AccountPayload | null
}

/**
 * The header's `⋯` overflow menu — content layer over the same popover
 * mechanics as SharePopover (anchored absolute panel, outside-mousedown +
 * Escape to close). Holds the secondary chrome (Panel/Focus toggles,
 * Feedback) and the ownership section: "Yours" + delete confirm, "Owned by
 * ‹name›", or the fallback Claim item (the banner is the primary claim CTA).
 */
export function HeaderMenu({
  panelOpen,
  onTogglePanel,
  focusMode,
  onToggleFocus,
  slug,
  ownership,
  claimerName,
  account,
}: Props) {
  const [open, setOpen] = useState(false)
  const [lockUpdating, setLockUpdating] = useState(false)
  const [lockFailed, setLockFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Same constraint as SharePopover: the sticky header's backdrop-filter is
  // the containing block for fixed descendants — the mobile sheet must
  // portal to body.
  const isMobile = useMediaQuery('(max-width: 48rem)')
  useDismissable(open, () => setOpen(false), [rootRef, popoverRef])

  const showOwnership = ownership.yours || ownership.claimed || ownership.claimable
  let lockLabel = 'Read only for others'
  if (lockUpdating) lockLabel = 'Updating access…'
  else if (lockFailed) lockLabel = 'Could not update — retry'

  return (
    <div className="share-root header-menu-root" ref={rootRef}>
      <button
        className="chrome-toggle header-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More options"
        title="More options"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open &&
        (() => {
          const popover = (
            <div
              className="share-popover header-menu-popover"
              ref={popoverRef}
              role="menu"
              aria-label="Document options"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="header-menu-item"
                role="menuitemcheckbox"
                aria-checked={panelOpen}
                onClick={onTogglePanel}
              >
                <span className="header-menu-check" aria-hidden>
                  {panelOpen ? '✓' : ''}
                </span>
                Side panel
                <span className="header-menu-hint">⌘\</span>
              </button>
              <button
                className="header-menu-item"
                role="menuitemcheckbox"
                aria-checked={focusMode}
                onClick={onToggleFocus}
              >
                <span className="header-menu-check" aria-hidden>
                  {focusMode ? '✓' : ''}
                </span>
                Suggestion focus
                <span className="header-menu-hint">⌘.</span>
              </button>
              {showOwnership && (
                <>
                  <div className="header-menu-sep" role="separator" />
                  {ownership.yours && (
                    <button
                      className="header-menu-item"
                      role="menuitemcheckbox"
                      aria-checked={ownership.editing_locked}
                      disabled={lockUpdating}
                      onClick={() => {
                        const locked = !ownership.editing_locked
                        setLockUpdating(true)
                        setLockFailed(false)
                        router.optimistic((props: { ownership?: OwnershipPayload }) => ({
                          ownership: {
                            ...(props.ownership ?? ownership),
                            editing_locked: locked,
                            can_write: true,
                          },
                        })).patch(
                          `/d/${slug}/editing_lock`,
                          { locked },
                          {
                            only: ['ownership', 'activities'],
                            preserveScroll: true,
                            async: true,
                            onError: () => setLockFailed(true),
                            onFinish: () => setLockUpdating(false),
                          },
                        )
                      }}
                    >
                      <span className="header-menu-check" aria-hidden>
                        {ownership.editing_locked ? '✓' : ''}
                      </span>
                      {lockLabel}
                    </button>
                  )}
                  {ownership.editing_locked && !ownership.yours && (
                    <div className="header-menu-status" role="status">
                      <span className="header-menu-check" aria-hidden>🔒</span>
                      Read only — locked by owner
                    </div>
                  )}
                  <OwnershipChip slug={slug} ownership={ownership} claimerName={claimerName} />
                </>
              )}
              {account && (
                <>
                  <div className="header-menu-sep" role="separator" />
                  <div className="header-menu-account" title={account.email}>{account.name}</div>
                  <Link href="/logout" method="delete" as="button" className="header-menu-item">
                    <span className="header-menu-check" aria-hidden>↪</span>
                    Sign out
                  </Link>
                </>
              )}
              <div className="header-menu-sep" role="separator" />
              <FeedbackButton />
            </div>
          )
          return isMobile
            ? createPortal(
                <div className="share-backdrop" onClick={() => setOpen(false)}>
                  {popover}
                </div>,
                document.body,
              )
            : popover
        })()}
    </div>
  )
}
