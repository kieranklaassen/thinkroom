import type { RefObject } from 'react'
import type { EditorView } from '@milkdown/kit/prose/view'
import { findCommentAnchorRange } from '../editor/comment_anchors'
import type { Comments } from '../pages/documents/use_comments'

interface Props extends Pick<
  Comments,
  | 'failedComment'
  | 'retryFailedComment'
  | 'checkFailedComment'
  | 'dismissFailedComment'
  | 'checkingComment'
  | 'commentNotice'
  | 'clearCommentNotice'
> {
  viewRef: RefObject<EditorView | null>
  canComment: boolean
}

/** A comment that was not saved keeps its draft here; otherwise, what happened
 *  to one that could not be confirmed. */
export function CommentRecovery({
  failedComment,
  retryFailedComment,
  checkFailedComment,
  dismissFailedComment,
  checkingComment,
  commentNotice,
  clearCommentNotice,
  viewRef,
  canComment,
}: Props) {
  return (
    <section className="comment-recovery" aria-label="Comment status">
      {failedComment ? <>
        <p role="alert">{failedComment.message}</p>
        {failedComment.anchor && <blockquote className="comment-quote">{failedComment.anchor}</blockquote>}
        {failedComment.anchor && viewRef.current && !findCommentAnchorRange(viewRef.current.state.doc, failedComment.anchor) && (
          <p className="comment-scope">Original text changed — retry keeps the quote as context.</p>
        )}
        <textarea aria-label="Unsent comment" readOnly value={failedComment.body} />
        <div className="comment-actions">
          {failedComment.uncertain
            ? <button type="button" disabled={checkingComment} onClick={checkFailedComment}>{checkingComment ? 'Checking…' : 'Check saved comments'}</button>
            : <button type="button" disabled={!canComment} onClick={retryFailedComment}>Retry comment</button>}
          {failedComment.uncertain && failedComment.checkedMissing && (
            <button type="button" disabled={!canComment || checkingComment} onClick={retryFailedComment}>Retry anyway</button>
          )}
          <button type="button" onClick={dismissFailedComment}>Discard draft</button>
        </div>
        {!canComment && <p className="comment-scope">Comment access is no longer available. You can copy your draft.</p>}
      </> : <>
        <p role="status">{commentNotice}</p>
        <button type="button" onClick={clearCommentNotice}>Dismiss</button>
      </>}
    </section>
  )
}
