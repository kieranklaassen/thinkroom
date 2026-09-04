import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CommentCard } from './comment_card'
import { truncate } from '../lib/truncate'
import type { CommentPayload } from '../types/payloads'

interface Props {
  comments: CommentPayload[]
  /** Linked open cards are rendered once in the desktop margin. */
  marginIds?: Set<number> | null
  showResolved: boolean
  onShowResolvedChange: (show: boolean) => void
  resolvingComments: Set<number>
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
  marginIds,
  showResolved,
  onShowResolvedChange,
  resolvingComments,
  composerAnchor,
  anchoredIds,
  onSubmit,
  onCancelComposer,
  onResolve,
  onJumpTo,
  onHover,
}: Props) {
  const [body, setBody] = useState('')
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
  const visibleOpen = open.filter((comment) => !marginIds?.has(comment.id))
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

      {marginIds && marginIds.size > 0 && <p className="rail-empty">{marginIds.size} beside the text</p>}
      {visibleOpen.length > 0 && marginIds && <p className="comment-scope">Other comments</p>}
      <ul className="comment-list">
        {visibleOpen.map((comment) => (
          <li key={comment.id}>
            <CommentCard comment={comment} linked={anchoredIds?.has(comment.id) ?? false}
              measured={anchoredIds !== null} resolving={resolvingComments.has(comment.id)} onResolve={onResolve} onJumpTo={onJumpTo} onHover={onHover} />
          </li>
        ))}
      </ul>

      {resolved.length > 0 && (
        <button
          className="comment-resolved-toggle"
          aria-expanded={showResolved}
          onClick={() => onShowResolvedChange(!showResolved)}
        >
          {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
        </button>
      )}
      {showResolved && (
        <ul className="comment-list comment-list--resolved">
          {resolved.map((comment) => (
            <li key={comment.id}>
              <CommentCard comment={comment} linked={false} measured={anchoredIds !== null}
                resolving={resolvingComments.has(comment.id)} onResolve={onResolve} onJumpTo={onJumpTo} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
