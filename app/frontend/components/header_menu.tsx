import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '../lib/use_media_query'
import { useDismissable } from '../lib/use_dismissable'
import { OwnershipChip, type OwnershipPayload } from './ownership_chip'
import { FeedbackButton } from './feedback_button'

interface Props {
  panelOpen: boolean
  onTogglePanel: () => void
  focusMode: boolean
  onToggleFocus: () => void
  slug: string
  ownership: OwnershipPayload
  claimerName: string
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
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Same constraint as SharePopover: the sticky header's backdrop-filter is
  // the containing block for fixed descendants — the mobile sheet must
  // portal to body.
  const isMobile = useMediaQuery('(max-width: 48rem)')
  useDismissable(open, () => setOpen(false), [rootRef, popoverRef])

  const ownershipLabel = ownership.yours
    ? 'Your document'
    : ownership.claimed
      ? 'Ownership'
      : ownership.claimable
        ? 'Claim'
        : null

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
              role="dialog"
              aria-label="Document options"
              onClick={(event) => event.stopPropagation()}
            >
          <div className="share-section">
            <div className="share-section-title">View</div>
            <div className="header-menu-row">
              <button
                className="chrome-toggle"
                aria-pressed={panelOpen}
                title="Hide/show panel — ⌘\"
                onClick={onTogglePanel}
              >
                Panel
              </button>
              <button
                className="chrome-toggle"
                aria-pressed={focusMode}
                title="Suggestion focus — ⌘."
                onClick={onToggleFocus}
              >
                Focus
              </button>
            </div>
          </div>
          {ownershipLabel && (
            <div className="share-section">
              <div className="share-section-title">{ownershipLabel}</div>
              <div className="header-menu-row">
                <OwnershipChip slug={slug} ownership={ownership} claimerName={claimerName} />
              </div>
            </div>
          )}
          <div className="share-section">
            <div className="share-section-title">Feedback</div>
            <div className="header-menu-row">
              <FeedbackButton />
            </div>
          </div>
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
