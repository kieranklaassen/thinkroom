import type { CommentPayload } from '../types/payloads'
import { timeAgo } from '../lib/time'
import { truncate } from '../lib/truncate'

interface Props {
  comment: CommentPayload
  linked: boolean
  measured: boolean
  resolving?: boolean
  onResolve: (comment: CommentPayload) => void
  onJumpTo: (comment: CommentPayload) => void
  onHover?: (comment: CommentPayload | null) => void
}

/** Shared by the margin, fallback rail and mobile sheet. Actions remain
 * separate buttons: resolving or selecting the body must never jump. */
export function CommentCard({ comment, linked, measured, resolving, onResolve, onJumpTo, onHover }: Props) {
  const canJump = linked && !comment.resolved
  const stale = measured && Boolean(comment.anchor_text) && !linked && !comment.resolved
  return (
    <article
      data-comment-id={comment.id}
      className={`comment-card ${canJump ? 'comment-card--linked' : ''} ${comment.resolved ? 'is-resolved' : ''}`}
      onClick={(event) => {
        if (!canJump || (event.target as Element).closest('button, a, input, textarea')) return
        const selection = window.getSelection()
        if (selection?.toString() && selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) return
        onJumpTo(comment)
      }}
      onMouseEnter={canJump && onHover ? () => onHover(comment) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      <header className="comment-meta">
        <span className={`author-chip author-chip--${comment.author_kind}`}>{comment.author_name}</span>
        <span className="comment-kind">{comment.author_kind === 'agent' ? 'Agent' : 'Human'}</span>
        <time className="comment-time" dateTime={comment.created_at} title={new Date(comment.created_at).toLocaleString()} suppressHydrationWarning>
          {timeAgo(comment.created_at)}
        </time>
      </header>
      {comment.anchor_text ? (
        <blockquote className={`comment-quote ${stale ? 'comment-quote--stale' : ''}`}>
          {truncate(comment.anchor_text, 160)}
        </blockquote>
      ) : <span className="comment-scope">On the whole document</span>}
      {stale && <span className="comment-scope">Quoted text changed or cannot be matched uniquely</span>}
      <p className="comment-body">{comment.body}</p>
      <footer className="comment-actions">
        {canJump && <button type="button" className="comment-jump" onClick={() => onJumpTo(comment)}>Show in document</button>}
        {resolving ? <span role="status" className="comment-scope">Resolving…</span>
          : comment.id < 0 ? <span role="status" className="comment-scope">Posting…</span>
          : comment.resolved ? <span className="comment-scope">Resolved</span>
          : <button type="button" className="comment-resolve" onClick={() => onResolve(comment)}>Resolve</button>}
      </footer>
    </article>
  )
}
