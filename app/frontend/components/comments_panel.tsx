import { useEffect, useRef, useState, type FormEvent } from 'react'
import { timeAgo } from '../lib/time'
import { truncate } from '../lib/truncate'
import type { CommentPayload } from '../types/payloads'

interface Props {
  comments: CommentPayload[]
  composerAnchor: string | null
  /** Ids of open comments whose anchor text resolves in the document; null
   *  while unmeasured (editor not mounted yet) — no linked/stale states then. */
  anchoredIds: Set<number> | null
  onSubmit: (body: string, anchorText: string | null) => void
  onCancelComposer: () => void
  onResolve: (comment: CommentPayload) => void
  onJumpTo: (comment: CommentPayload) => void
  onHover?: (comment: CommentPayload | null) => void
}

export function CommentsPanel({
  comments,
  composerAnchor,
  anchoredIds,
  onSubmit,
  onCancelComposer,
  onResolve,
  onJumpTo,
  onHover,
}: Props) {
  const [body, setBody] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (composerAnchor !== null) textareaRef.current?.focus()
  }, [composerAnchor])

  // The panel can unmount under the cursor (mode switch, layout collapse) —
  // mouseleave never fires then, so the hover spotlight must clear here.
  useEffect(() => {
    return () => onHover?.(null)
  }, [onHover])

  const open = comments.filter((c) => !c.resolved)
  const resolved = comments.filter((c) => c.resolved)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    onSubmit(trimmed, composerAnchor)
    setBody('')
  }

  return (
    <section className="rail-section" aria-label="Comments">
      <header className="rail-heading">
        <h2>Comments</h2>
        {open.length > 0 && <span className="rail-count">{open.length}</span>}
      </header>

      {composerAnchor !== null && (
        <form className="comment-composer" onSubmit={submit}>
          {composerAnchor && (
            <blockquote className="comment-quote">{truncate(composerAnchor, 120)}</blockquote>
          )}
          <textarea
            ref={textareaRef}
            className="comment-input"
            rows={2}
            placeholder="Say something about this…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event)
              if (event.key === 'Escape') onCancelComposer()
            }}
          />
          <div className="comment-composer-actions">
            <button type="submit" className="btn-accept" disabled={!body.trim()}>
              Comment
            </button>
            <button type="button" className="btn-reject" onClick={onCancelComposer}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {open.length === 0 && composerAnchor === null && (
        <p className="rail-empty">Select any text to start a conversation.</p>
      )}

      <ul className="comment-list">
        {open.map((comment) => {
          // Three anchor states once measured: linked (text found — the whole
          // card jumps to it), stale (quoted text edited away), unanchored
          // (comment was never tied to text). Unmeasured renders plain, and
          // so does an unresolved multi-block anchor — its matcher can miss
          // text that is still present, and the card must not claim it gone.
          const linked = anchoredIds !== null && anchoredIds.has(comment.id)
          const stale =
            anchoredIds !== null &&
            Boolean(comment.anchor_text) &&
            !comment.anchor_text!.includes('\n') &&
            !linked
          return (
            <li
              key={comment.id}
              className={`comment-card ${linked ? 'comment-card--linked' : ''}`}
              onClick={linked ? () => onJumpTo(comment) : undefined}
              onMouseEnter={linked && onHover ? () => onHover(comment) : undefined}
              onMouseLeave={linked && onHover ? () => onHover(null) : undefined}
              title={linked ? 'Show in document' : undefined}
            >
              <div className="comment-meta">
                <span className={`author-chip author-chip--${comment.author_kind}`}>
                  {comment.author_name}
                </span>
                {/* timeAgo depends on Date.now(); a bucket flip between SSR and
                 hydration would otherwise regenerate the whole tree. */}
                <span className="comment-time" suppressHydrationWarning>
                  {timeAgo(comment.created_at)}
                </span>
              </div>
              {comment.anchor_text ? (
                <blockquote className={`comment-quote ${stale ? 'comment-quote--stale' : ''}`}>
                  {truncate(comment.anchor_text, 90)}
                </blockquote>
              ) : (
                anchoredIds !== null && (
                  <span className="comment-scope">On the whole document</span>
                )
              )}
              {stale && (
                <span className="comment-scope">Quoted text is no longer in the document</span>
              )}
              <p className="comment-body">{comment.body}</p>
              {/* Optimistic placeholders (negative id) have no server row yet —
                a resolve PATCH against them would 404. The button appears
                when the reload delivers the real id (same gate as the
                suggestion cards' accept/reject). */}
              {comment.id > 0 && (
                <button
                  className="comment-resolve"
                  onClick={(event) => {
                    // The linked card's own click would also fire and jump.
                    event.stopPropagation()
                    onResolve(comment)
                  }}
                >
                  Resolve
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {resolved.length > 0 && (
        <button
          className="comment-resolved-toggle"
          onClick={() => setShowResolved((value) => !value)}
        >
          {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
        </button>
      )}
      {showResolved && (
        <ul className="comment-list comment-list--resolved">
          {resolved.map((comment) => (
            <li key={comment.id} className="comment-card is-resolved">
              <div className="comment-meta">
                <span className={`author-chip author-chip--${comment.author_kind}`}>
                  {comment.author_name}
                </span>
                {/* timeAgo depends on Date.now(); a bucket flip between SSR and
                 hydration would otherwise regenerate the whole tree. */}
              <span className="comment-time" suppressHydrationWarning>
                {timeAgo(comment.created_at)}
              </span>
              </div>
              <p className="comment-body">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
