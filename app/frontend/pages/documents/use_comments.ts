import { useCallback, useEffect, useState, type RefObject } from 'react'
import { router } from '@inertiajs/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import { findCommentAnchorRange } from '../../editor/comment_anchors'
import { domRange, setHighlight, clearHighlight } from '../../lib/highlights'
import type { CommentPayload } from '../../types/payloads'

interface Options {
  slug: string
  identityName: string
  viewRef: RefObject<EditorView | null>
  /** Mode switches close the composer without posting (same as Cancel). */
  effectiveMode: string
  isMobile: boolean
  /** Keeps the anchor highlight tracking edits around the anchor. */
  docTick: number
}

export interface Comments {
  /** Anchor text for the open composer, or null when closed. */
  composerAnchor: string | null
  /** The desktop anchored composer card is open (mobile uses the sheet). */
  composerOpen: boolean
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
  slug,
  identityName,
  viewRef,
  effectiveMode,
  isMobile,
  docTick,
}: Options): Comments {
  const [composerAnchor, setComposerAnchor] = useState<string | null>(null)
  const composerOpen = !isMobile && composerAnchor !== null

  useEffect(() => {
    setComposerAnchor(null)
  }, [effectiveMode])

  // The anchored text stays visibly marked while the composer is open —
  // the editor selection itself collapses when focus moves to the textarea.
  useEffect(() => {
    if (!composerOpen || composerAnchor === null) return
    const view = viewRef.current
    if (!view) return
    const range = findCommentAnchorRange(view.state.doc, composerAnchor)
    const dom = range ? domRange(view, range.from, range.to) : null
    setHighlight('comment-anchor-draft', dom ? [dom] : [])
    return () => clearHighlight('comment-anchor-draft')
    // docTick keeps the highlight tracking edits around the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, composerAnchor, docTick])

  const submitComment = useCallback(
    (body: string, anchorText: string | null) => {
      setComposerAnchor(null)
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
          { preserveScroll: true, only: ['comments', 'activities'], async: true },
        )
    },
    [slug, identityName],
  )

  const resolveComment = useCallback(
    (comment: CommentPayload) => {
      // Optimistic placeholders (negative id) have no server row yet — a
      // PATCH against them would 404 (the panel also hides the button).
      if (comment.id < 0) return
      router
        .optimistic((props: { comments?: CommentPayload[] }) => ({
          comments: (props.comments ?? []).map((c) =>
            c.id === comment.id ? { ...c, resolved: true } : c,
          ),
        }))
        .patch(
          `/comments/${comment.id}/resolve`,
          { by: identityName },
          { preserveScroll: true, only: ['comments', 'activities'], async: true },
        )
    },
    [identityName],
  )

  const openComposer = useCallback((anchorText: string) => {
    setComposerAnchor(anchorText)
  }, [])

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
    composerAnchor,
    composerOpen,
    openComposer,
    closeComposer,
    cancelComposer,
    submitComment,
    submitAnchoredComment,
    resolveComment,
  }
}
