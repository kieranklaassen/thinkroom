import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, router } from '@inertiajs/react'
import { useMediaQuery } from '../lib/use_media_query'
import { useDismissable } from '../lib/use_dismissable'
import {
  OwnershipChip,
  type LinkAccess,
  type OwnershipPayload,
} from './ownership_chip'
import { FeedbackButton } from './feedback_button'
import { ThemePicker } from './theme_picker'
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
  feedbackAutomationEnabled: boolean
}

const LINK_ACCESS_OPTIONS: ReadonlyArray<{
  value: LinkAccess
  label: string
  hint: string
}> = [
  { value: 'edit', label: 'Can edit', hint: 'Edit, suggest, and comment' },
  { value: 'comment', label: 'Can comment', hint: 'Comment and read' },
  { value: 'view', label: 'Can view', hint: 'Read only' },
]

/**
 * The header's `⋯` document-options dialog — content layer over the same popover
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
  feedbackAutomationEnabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [accessUpdating, setAccessUpdating] = useState(false)
  const [accessFailed, setAccessFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const viewLabelId = useId()
  const accessLabelId = useId()
  const accountLabelId = useId()
  const helpLabelId = useId()
  // Same constraint as SharePopover: the sticky header's backdrop-filter is
  // the containing block for fixed descendants — the mobile sheet must
  // portal to body.
  const isMobile = useMediaQuery('(max-width: 48rem)')
  useDismissable(open, () => setOpen(false), [rootRef, popoverRef])

  const showOwnership = ownership.yours || ownership.claimed || ownership.claimable
  const activeAccess = LINK_ACCESS_OPTIONS.find(({ value }) => value === ownership.link_access)!

  return (
    <div className="share-root header-menu-root" ref={rootRef}>
      <button
        className="chrome-toggle header-menu-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
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
              <div className="header-menu-group" role="group" aria-labelledby={viewLabelId}>
                <div className="header-menu-label" id={viewLabelId}>View</div>
                <button
                  className="header-menu-item"
                  aria-pressed={panelOpen}
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
                  aria-pressed={focusMode}
                  onClick={onToggleFocus}
                >
                  <span className="header-menu-check" aria-hidden>
                    {focusMode ? '✓' : ''}
                  </span>
                  Suggestion focus
                  <span className="header-menu-hint">⌘.</span>
                </button>
                <div className="header-menu-theme">
                  <span>Theme</span>
                  <ThemePicker />
                </div>
              </div>
              {showOwnership && (
                <div className="header-menu-group" role="group" aria-labelledby={accessLabelId}>
                  <div className="header-menu-label" id={accessLabelId}>Access</div>
                  {ownership.yours ? (
                    <div
                      className="header-menu-access"
                      role="radiogroup"
                      aria-label="Anyone with the link"
                    >
                      {LINK_ACCESS_OPTIONS.map(({ value, label, hint }) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={ownership.link_access === value}
                          className="header-menu-access-option"
                          disabled={accessUpdating}
                          onClick={() => {
                            if (value === ownership.link_access) return
                            setAccessUpdating(true)
                            setAccessFailed(false)
                            router.optimistic((props: { ownership?: OwnershipPayload }) => ({
                              ownership: {
                                ...(props.ownership ?? ownership),
                                link_access: value,
                                editing_locked: value !== 'edit',
                                can_write: true,
                                can_comment: true,
                              },
                            })).patch(
                              `/d/${slug}/link_access`,
                              { access: value },
                              {
                                only: ['ownership', 'activities'],
                                preserveScroll: true,
                                async: true,
                                onError: () => setAccessFailed(true),
                                onFinish: () => setAccessUpdating(false),
                              },
                            )
                          }}
                        >
                          <span className="header-menu-access-check" aria-hidden>
                            {ownership.link_access === value ? '✓' : ''}
                          </span>
                          <span>
                            <span className="header-menu-access-label">{label}</span>
                            <span className="header-menu-access-hint">{hint}</span>
                          </span>
                        </button>
                      ))}
                      {accessFailed && (
                        <span className="header-menu-access-error" role="alert">
                          Could not update link access — try again
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="header-menu-status" role="status">
                      <span className="header-menu-check" aria-hidden>↗</span>
                      Anyone with the link {activeAccess.label.toLowerCase()}
                    </div>
                  )}
                  <OwnershipChip slug={slug} ownership={ownership} claimerName={claimerName} />
                </div>
              )}
              {account && (
                <div className="header-menu-group" role="group" aria-labelledby={accountLabelId}>
                  <div className="header-menu-label" id={accountLabelId}>Account</div>
                  <div className="header-menu-account" title={account.email}>{account.name}</div>
                  <Link href="/logout" method="delete" as="button" className="header-menu-item">
                    <span className="header-menu-check" aria-hidden>↪</span>
                    Sign out
                  </Link>
                </div>
              )}
              <div className="header-menu-group" role="group" aria-labelledby={helpLabelId}>
                <div className="header-menu-label" id={helpLabelId}>Help</div>
                <FeedbackButton automationEnabled={feedbackAutomationEnabled} />
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
