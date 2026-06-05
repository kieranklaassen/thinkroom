import { useEffect, useRef, useState, type FormEvent } from 'react'
import { timeAgo } from '../lib/time'
import { truncate } from '../lib/truncate'

export interface CommentPayload {
  id: number
  author_name: string
  author_kind: string
  body: string
  anchor_text: string | null
  resolved: boolean
  created_at: string
}

interface Props {
  comments: CommentPayload[]
  composerAnchor: string | null
  onSubmit: (body: string, anchorText: string | null) => void
  onCancelComposer: () => void
  onResolve: (comment: CommentPayload) => void
  onJumpTo: (anchorText: string) => void
}

export function CommentsPanel({
  comments,
  composerAnchor,
  onSubmit,
  onCancelComposer,
  onResolve,
  onJumpTo,
}: Props) {
  const [body, setBody] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (composerAnchor !== null) textareaRef.current?.focus()
  }, [composerAnchor])

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
        {open.map((comment) => (
          <li key={comment.id} className="comment-card">
            <div className="comment-meta">
              <span className={`author-chip author-chip--${comment.author_kind}`}>
                {comment.author_name}
              </span>
              <span className="comment-time">{timeAgo(comment.created_at)}</span>
            </div>
            {comment.anchor_text && (
              <blockquote
                className="comment-quote comment-quote--link"
                onClick={() => onJumpTo(comment.anchor_text!)}
                title="Jump to text"
              >
                {truncate(comment.anchor_text, 90)}
              </blockquote>
            )}
            <p className="comment-body">{comment.body}</p>
            <button className="comment-resolve" onClick={() => onResolve(comment)}>
              Resolve
            </button>
          </li>
        ))}
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
                <span className="comment-time">{timeAgo(comment.created_at)}</span>
              </div>
              <p className="comment-body">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
