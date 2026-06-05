import { useCallback, useEffect, useRef, useState } from 'react'

/** Share is two audiences, one URL: humans get the editor, agents fetching the
 *  same link discover the API. The popover teaches both — copy the link for a
 *  person, or copy an agent invite that tells an agent exactly how to join. */
export function SharePopover({ agentsActive }: { agentsActive: number }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'link' | 'agent' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="share-root" ref={rootRef}>
      <button
        className="share-button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Share
      </button>
      {open && (
        <div className="share-popover" role="dialog" aria-label="Share this document">
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
        </div>
      )}
    </div>
  )
}
