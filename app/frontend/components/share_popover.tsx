import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '../lib/use_media_query'
import { useDismissable } from '../lib/use_dismissable'
import { ThemePicker } from './theme_picker'

/** Share is two audiences, one URL: humans get the editor, agents fetching the
 *  same link discover the API. The popover teaches both — copy the link for a
 *  person, or copy an agent invite that tells an agent exactly how to join. */
export function SharePopover({
  agentsActive,
  onOpenChange,
}: {
  agentsActive: number
  /** Lets the page suppress selection chrome while the popover is open. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(false)
  const [copied, setCopied] = useState<'link' | 'agent' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // The sticky header's backdrop-filter makes it the containing block for
  // fixed descendants — so the mobile full-width sheet must portal to body.
  const isMobile = useMediaQuery('(max-width: 48rem)')

  const setOpen = useCallback(
    (next: boolean | ((value: boolean) => boolean)) => {
      setOpenState((value) => {
        const resolved = typeof next === 'function' ? next(value) : next
        if (resolved !== value) onOpenChange?.(resolved)
        return resolved
      })
    },
    [onOpenChange],
  )

  const url = typeof window === 'undefined' ? '' : window.location.href

  const agentInvite =
    `Join my Pruf document as a collaborator: ${url}\n` +
    `Fetch that URL (Accept: text/plain) for full API instructions. ` +
    `Identify yourself with an X-Agent-Name header on every request — ` +
    `your edits, suggestions, and comments will appear live, attributed to you.`

  const copy = useCallback((kind: 'link' | 'agent', text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(kind)
      setTimeout(() => setCopied(null), 1600)
    })
  }, [])

  useDismissable(open, () => setOpen(false), [rootRef, popoverRef])

  const popover = (
    <div
      className="share-popover"
      ref={popoverRef}
      role="dialog"
      aria-label="Share this document"
      onClick={(event) => event.stopPropagation()}
    >
          <div className="share-section">
            <div className="share-section-title">People</div>
            <p className="share-section-hint">Anyone with the link joins this live document.</p>
            <div className="share-copy-row">
              <code className="share-url">{url}</code>
              <button className="share-copy" onClick={() => copy('link', url)}>
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
          <div className="share-section share-section--agent">
            <div className="share-section-title">
              Your agent
              <span className={`share-agent-dot ${agentsActive > 0 ? 'is-on' : ''}`} />
              <span className="share-agent-state">
                {agentsActive > 0 ? `${agentsActive} active now` : 'same URL, different audience'}
              </span>
            </div>
            <p className="share-section-hint">
              Agents fetching this link discover the API: state, suggestions, comments,
              presence — identified by <code>X-Agent-Name</code>.
            </p>
            <button className="share-copy share-copy--wide" onClick={() => copy('agent', agentInvite)}>
              {copied === 'agent' ? 'Copied — paste it to your agent' : 'Copy agent invite'}
            </button>
          </div>
      {/* The header stays minimal — the reading theme lives here, on every
          surface (desktop popover and mobile sheet alike). */}
      <div className="share-section share-section--theme">
        <div className="share-section-title">Theme</div>
        <ThemePicker />
      </div>
    </div>
  )

  return (
    <div className="share-root" ref={rootRef}>
      <button
        className="share-button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Share
      </button>
      {open &&
        (isMobile
          ? createPortal(
              <div className="share-backdrop" onClick={() => setOpen(false)}>
                {popover}
              </div>,
              document.body,
            )
          : popover)}
    </div>
  )
}
