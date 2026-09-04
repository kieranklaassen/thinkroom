import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { router } from '@inertiajs/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import { findCommentAnchorRange, type CommentRange } from '../../editor/comment_anchors'
import { fromRelativePosition, toRelativePosition } from '../../editor/collab_positions'
import { domRange, setHighlight, clearHighlight } from '../../lib/highlights'
import type { CommentPayload } from '../../types/payloads'

interface Options {
  comments: CommentPayload[]
  canComment: boolean
  slug: string
  identityName: string
  viewRef: RefObject<EditorView | null>
  /** Mode switches close the composer without posting (same as Cancel). */
  effectiveMode: string
  isMobile: boolean
  /** Keeps the anchor highlight tracking edits around the anchor. */
  docTick: number
}

export interface FailedComment {
  body: string
  anchor: string | null
  message: string
  uncertain: boolean
  previousIds: number[]
  authorName: string
  checkedMissing: boolean
}

export interface Comments {
  failedComment: FailedComment | null
  retryFailedComment: () => void
  checkFailedComment: () => void
  dismissFailedComment: () => void
  checkingComment: boolean
  commentNotice: string | null
  clearCommentNotice: () => void
  resolvingComments: Set<number>
  /** Anchor text for the open composer, or null when closed. */
  composerAnchor: string | null
  /** The desktop anchored composer card is open (mobile uses the sheet). */
  composerOpen: boolean
  getComposerRange: () => CommentRange | null
  openComposer: (anchorText: string) => void
  /** Close without posting and return focus to the editor. */
  closeComposer: () => void
  /** Close without posting or refocusing (mobile sheet cancel). */
  cancelComposer: () => void
  submitComment: (body: string, anchorText: string | null) => void
  submitAnchoredComment: (body: string) => void
  resolveComment: (comment: CommentPayload) => void
}

/** Comment submission/resolution and the anchored composer lifecycle. */
export function useComments({
  comments,
  canComment,
  slug,
  identityName,
  viewRef,
  effectiveMode,
  isMobile,
  docTick,
}: Options): Comments {
  const [failedComment, setFailedComment] = useState<FailedComment | null>(null)
  const [commentNotice, setCommentNotice] = useState<string | null>(null)
  const [checkingComment, setCheckingComment] = useState(false)
  const [resolvingComments, setResolvingComments] = useState(new Set<number>())
  const [resolveErrors, setResolveErrors] = useState(new Set<number>())
  const postingRef = useRef(false)
  const checkGeneration = useRef(0)
  const resolvingRef = useRef(new Set<number>())
  const commentsRef = useRef(comments)
  commentsRef.current = comments
  const [composerAnchor, setComposerAnchor] = useState<string | null>(null)
  const composerOpen = !isMobile && composerAnchor !== null
  const composerBinding = useRef<{ from: unknown; to: unknown } | null>(null)
  const getComposerRange = useCallback((): CommentRange | null => {
    const view = viewRef.current
    const binding = composerBinding.current
    if (!view || !binding || composerAnchor === null) return null
    const from = fromRelativePosition(view.state, binding.from)
    const to = fromRelativePosition(view.state, binding.to)
    if (from !== null && to !== null && from < to && to <= view.state.doc.content.size &&
        view.state.doc.textBetween(from, to, '\n') === composerAnchor) return { from, to }
    composerBinding.current = null // never switch to another copy mid-draft
    return null
  }, [composerAnchor, viewRef])

  useEffect(() => {
    setComposerAnchor(null)
  }, [effectiveMode])

  // The anchored text stays visibly marked while the composer is open —
  // the editor selection itself collapses when focus moves to the textarea.
  useEffect(() => {
    if (!composerOpen || composerAnchor === null) return
    const view = viewRef.current
    if (!view) return
    const range = getComposerRange()
    const dom = range ? domRange(view, range.from, range.to) : null
    setHighlight('comment-anchor-draft', dom ? [dom] : [])
    return () => clearHighlight('comment-anchor-draft')
    // docTick keeps the highlight tracking edits around the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, composerAnchor, docTick, getComposerRange])

  const submitComment = useCallback(
    (body: string, anchorText: string | null) => {
      if (postingRef.current || !canComment || !body.trim()) return
      postingRef.current = true
      checkGeneration.current++
      setCheckingComment(false)
      setFailedComment(null)
      setCommentNotice(null)
      setComposerAnchor(null)
      const previousIds = commentsRef.current.map((comment) => comment.id)
      const failed = (message: string, uncertain = false) => {
        setFailedComment({ body, anchor: anchorText, message, uncertain, previousIds, authorName: identityName, checkedMissing: false })
        return false
      }
      const optimisticComment: CommentPayload = {
        id: -Date.now(),
        author_name: identityName,
        author_kind: 'human',
        body,
        anchor_text: anchorText,
        resolved: false,
        created_at: new Date().toISOString(),
      }
      router
        .optimistic((props: { comments?: CommentPayload[] }) => ({
          comments: [...(props.comments ?? []), optimisticComment],
        }))
        .post(
          `/d/${slug}/comments`,
          { body, anchor_text: anchorText, author_name: identityName },
          {
            preserveScroll: true, only: ['comments', 'activities', 'ownership'], async: true,
            onError: (errors) => { failed(String(errors.comment ?? 'Could not post this comment.')) },
            onHttpException: (response) => failed(`Could not post this comment (${response.status}).`, response.status >= 500 || response.status === 408),
            onNetworkError: () => failed('Connection lost. This comment may already be saved.', true),
            onCancel: () => { failed('Posting was interrupted. Check whether the comment was saved.', true) },
            onFinish: () => { postingRef.current = false },
          },
        )
    },
    [slug, identityName, canComment],
  )

  const resolveComment = useCallback(
    (comment: CommentPayload) => {
      // Optimistic placeholders (negative id) have no server row yet — a
      // PATCH against them would 404 (the panel also hides the button).
      const current = commentsRef.current.find((row) => row.id === comment.id)
      if (comment.id <= 0 || !current || current.resolved || !canComment || resolvingRef.current.has(comment.id)) return
      resolvingRef.current.add(comment.id)
      setResolvingComments(new Set(resolvingRef.current))
      const failed = () => {
        setResolveErrors((errors) => new Set(errors).add(comment.id))
        return false
      }
      let confirmed = false
      router
        .optimistic((props: { comments?: CommentPayload[] }) => ({
          comments: (props.comments ?? []).map((c) =>
            c.id === comment.id ? { ...c, resolved: true } : c,
          ),
        }))
        .patch(
          `/comments/${comment.id}/resolve`,
          { by: identityName },
          {
            preserveScroll: true, only: ['comments', 'activities', 'ownership'], async: true,
            onSuccess: () => {
              confirmed = true
              setResolveErrors((errors) => {
                if (!errors.has(comment.id)) return errors
                const next = new Set(errors)
                next.delete(comment.id)
                return next
              })
            },
            onError: () => { failed() },
            onHttpException: failed,
            onNetworkError: failed,
            onCancel: () => { failed() },
            onFinish: () => {
              resolvingRef.current.delete(comment.id)
              setResolvingComments(new Set(resolvingRef.current))
              // A confirmed response already carries fresh comments. Reconcile
              // uncertain outcomes; Inertia preserves any pending optimistic post.
              if (!confirmed) router.reload({ only: ['comments', 'ownership'], onHttpException: () => false, onNetworkError: () => false })
            },
          },
        )
    },
    [identityName, canComment],
  )

  const openComposer = useCallback((anchorText: string) => {
    if (postingRef.current || failedComment) return
    const state = viewRef.current?.state
    composerBinding.current = null
    if (state) {
      const { from, to, $from, empty } = state.selection
      // A new draft knows which occurrence was selected/clicked. Saved
      // quote-only comments do not: they still use the unique matcher.
      const range: CommentRange | null = !empty && state.doc.textBetween(from, to, '\n') === anchorText
        ? { from, to }
        : $from.depth > 0 && $from.parent.textBetween(0, $from.parent.content.size, '\n') === anchorText
          ? { from: $from.start(), to: $from.end() }
          : findCommentAnchorRange(state.doc, anchorText)
      if (range) {
        const start = toRelativePosition(state, range.from)
        const end = toRelativePosition(state, range.to, -1)
        if (start && end) composerBinding.current = { from: start, to: end }
      }
    }
    setComposerAnchor(anchorText)
  }, [failedComment, viewRef])

  const retryFailedComment = useCallback(() => {
    if (!failedComment || (failedComment.uncertain && !failedComment.checkedMissing) || !canComment) return
    submitComment(failedComment.body, failedComment.anchor)
  }, [failedComment, canComment, submitComment])

  const checkFailedComment = useCallback(() => {
    if (!failedComment || checkingComment) return
    const generation = ++checkGeneration.current
    setCheckingComment(true)
    router.reload({
      only: ['comments', 'ownership'],
      onSuccess: (page) => {
        if (generation !== checkGeneration.current) return
        const rows = page.props.comments as CommentPayload[]
        const saved = rows.some((row) => !failedComment.previousIds.includes(row.id) && row.id > 0 &&
          row.author_kind === 'human' && row.author_name === failedComment.authorName &&
          row.body === failedComment.body && row.anchor_text === failedComment.anchor)
        if (saved) {
          setFailedComment(null)
          setCommentNotice('A matching comment is already saved. It was not posted again.')
        } else {
          setFailedComment({ ...failedComment, checkedMissing: true, message: 'No saved copy found yet. Check again, or retry anyway. Retrying could create a duplicate if the original request is still completing.' })
        }
      },
      onHttpException: () => false,
      onNetworkError: () => false,
      onFinish: () => { if (generation === checkGeneration.current) setCheckingComment(false) },
    })
  }, [failedComment, checkingComment])

  const cancelComposer = useCallback(() => {
    setComposerAnchor(null)
  }, [])

  const closeComposer = useCallback(() => {
    setComposerAnchor(null)
    viewRef.current?.focus()
  }, [viewRef])

  const submitAnchoredComment = useCallback(
    (body: string) => {
      submitComment(body, composerAnchor)
      viewRef.current?.focus()
    },
    [submitComment, composerAnchor, viewRef],
  )

  return {
    failedComment,
    retryFailedComment,
    checkFailedComment,
    dismissFailedComment: () => {
      checkGeneration.current++
      setCheckingComment(false)
      setFailedComment(null)
    },
    checkingComment,
    commentNotice: resolveErrors.size > 0
      ? 'Could not confirm resolution. Check your connection and try Resolve again if the comment is still open.'
      : resolvingComments.size > 0 ? 'Resolving comment…' : commentNotice,
    clearCommentNotice: () => {
      setCommentNotice(null)
      setResolveErrors(new Set())
    },
    resolvingComments,
    composerAnchor,
    composerOpen,
    getComposerRange,
    openComposer,
    closeComposer,
    cancelComposer,
    submitComment,
    submitAnchoredComment,
    resolveComment,
  }
}
