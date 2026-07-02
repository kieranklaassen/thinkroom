import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '../lib/use_media_query'
import { useDismissable } from '../lib/use_dismissable'
import type { LinkAccess } from './ownership_chip'

const LINK_ACCESS_HINTS: Record<LinkAccess, string> = {
  edit: 'Anyone with the link can open and edit this live document.',
  comment: 'Anyone with the link can read and comment on this live document.',
  view: 'Anyone with the link can read this document.',
}

/** Share is two audiences, one URL: humans get the editor, agents fetching the
 *  same link discover the API. The popover teaches both — copy the link for a
 *  person, or copy an agent invite that tells an agent exactly how to join. */
export function SharePopover({
  agentsActive,
  exportReady,
  linkAccess,
  canChangeAccess,
  onExportMarkdown,
  onExportHtml,
  onPrint,
  onOpenChange,
}: {
  agentsActive: number
  exportReady: boolean
  /** What the shared link actually grants, so the hint never oversells. */
  linkAccess: LinkAccess
  /** Owners get pointed at where the level is changed. */
  canChangeAccess: boolean
  onExportMarkdown: () => void | Promise<void>
  onExportHtml: () => void | Promise<void>
  onPrint: () => void
  /** Lets the page suppress selection chrome while the popover is open. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(false)
  const [copied, setCopied] = useState<'link' | 'agent' | null>(null)
  const [exportState, setExportState] = useState<'markdown' | 'html' | 'print' | 'error' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // The sticky header's backdrop-filter makes it the containing block for
  // fixed descendants — so the mobile full-width sheet must portal to body.
  const isMobile = useMediaQuery('(max-width: 48rem)')

  const setOpen = useCallback((next: boolean | ((value: boolean) => boolean)) => {
    setOpenState((value) => (typeof next === 'function' ? next(value) : next))
  }, [])

  useEffect(() => {
    onOpenChange?.(open)
  }, [onOpenChange, open])

  const url = typeof window === 'undefined' ? '' : window.location.href

  const agentInvite =
    `Join my Thinkroom document as a collaborator: ${url}\n` +
    `Fetch that URL (Accept: text/plain) for full API instructions. ` +
    `Identify yourself with an X-Agent-Name header on every request — ` +
    `your edits, suggestions, and comments will appear live, attributed to you.`

  const copy = useCallback((kind: 'link' | 'agent', text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(kind)
      setTimeout(() => setCopied(null), 1600)
    })
  }, [])

  const runExport = useCallback(
    async (kind: 'markdown' | 'html' | 'print', action: () => void | Promise<void>) => {
      if (!exportReady || (exportState !== null && exportState !== 'error')) return
      setExportState(kind)
      try {
        await action()
        setExportState(null)
      } catch (error) {
        console.warn('thinkroom: document export failed', kind, error)
        setExportState('error')
      }
    },
    [exportReady, exportState],
  )

  const exportBusy = exportState !== null && exportState !== 'error'

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
        <div className="share-section-title">Share link</div>
        <p className="share-section-hint">
          {LINK_ACCESS_HINTS[linkAccess]}
          {canChangeAccess ? ' Change link access from the ⋯ menu.' : ''}
        </p>
        <div className="share-copy-row">
          <code className="share-url">{url}</code>
          <button className="share-copy" onClick={() => copy('link', url)}>
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
      <div className="share-section share-section--agent">
        <div className="share-section-title">
          Agent invite
          <span className={`share-agent-dot ${agentsActive > 0 ? 'is-on' : ''}`} />
          <span className="share-agent-state">
            {agentsActive > 0 ? `${agentsActive} active now` : 'for an API-capable agent'}
          </span>
        </div>
        <p className="share-section-hint">
          Give an agent this invite to discover the document API and join as an
          attributed collaborator.
        </p>
        <button className="share-copy share-copy--wide" onClick={() => copy('agent', agentInvite)}>
          {copied === 'agent' ? 'Copied — paste it to your agent' : 'Copy agent invite'}
        </button>
      </div>
      <div className="share-section share-section--export">
        <div className="share-section-title">Export</div>
        <p className="share-section-hint">
          Download a clean copy, or print to paper or PDF.
        </p>
        <div className="share-export-actions">
          <button
            className="share-copy"
            disabled={!exportReady || exportBusy}
            onClick={() => void runExport('markdown', onExportMarkdown)}
          >
            {exportState === 'markdown' ? 'Preparing…' : 'Markdown'}
          </button>
          <button
            className="share-copy"
            disabled={!exportReady || exportBusy}
            onClick={() => void runExport('html', onExportHtml)}
          >
            {exportState === 'html' ? 'Preparing…' : 'HTML'}
          </button>
          <button
            className="share-copy"
            disabled={!exportReady || exportBusy}
            onClick={() => void runExport('print', onPrint)}
          >
            Print / PDF
          </button>
        </div>
        {!exportReady && <p className="share-export-status">Preparing document…</p>}
        {exportState === 'error' && (
          <p className="share-export-status is-error" role="status">
            Export failed. Try again.
          </p>
        )}
      </div>
    </div>
  )

  return (
    <div className="share-root" ref={rootRef}>
      <button
        className="share-button"
        aria-expanded={open}
        aria-haspopup="dialog"
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
