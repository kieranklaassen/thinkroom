import { useCallback, useEffect, useRef, useState } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorHandle } from '../../editor/milkdown_editor'
import { findTextRange } from '../../editor/suggestions'
import { clearHighlight, domRange, setHighlight } from '../../lib/highlights'
import type { CommentPayload } from '../../types/payloads'

interface Options {
  comments: CommentPayload[]
  handle: EditorHandle | null
  /** Re-resolves anchors on local and remote document changes. */
  docTick: number
  /** Comment mode keeps every open anchor tinted in the copy; other modes
   *  only highlight on hover/jump. */
  tintAll: boolean
}

export interface CommentAnchors {
  /** Ids of open comments whose anchor text currently resolves in the doc.
   *  Null until the editor has mounted and the first measure ran — the panel
   *  must not show "text is gone" states it hasn't verified. */
  anchoredIds: Set<number> | null
  /** Strong-tint the hovered card's anchor (null clears). */
  hoverAnchor: (comment: CommentPayload | null) => void
  /** Scroll the comment's anchor into view and pulse it. */
  jumpToComment: (comment: CommentPayload) => void
}

/**
 * Connects rail comment cards to the text they discuss. Anchors are the
 * same string-match resolution the composer highlight uses (first
 * within-block occurrence); ranges are re-resolved per doc version so
 * highlights track edits around them, mirroring MarginSuggestions'
 * anchor tinting.
 */
export function useCommentAnchors({
  comments,
  handle,
  docTick,
  tintAll,
}: Options): CommentAnchors {
  const rangesRef = useRef(new Map<number, Range>())
  const [anchoredIds, setAnchoredIds] = useState<Set<number> | null>(null)

  useEffect(() => {
    if (!handle) return

    let view: EditorView
    try {
      view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
    } catch {
      return // editor torn down mid-navigation
    }

    const ranges = new Map<number, Range>()
    for (const comment of comments) {
      if (comment.resolved || !comment.anchor_text) continue
      const range = findTextRange(view.state.doc, comment.anchor_text)
      const dom = range ? domRange(view, range.from, range.to) : null
      if (dom) ranges.set(comment.id, dom)
    }
    rangesRef.current = ranges

    setHighlight('comment-anchor', tintAll ? [...ranges.values()] : [])
    setAnchoredIds((prev) => {
      const next = new Set(ranges.keys())
      if (prev && prev.size === next.size && [...next].every((id) => prev.has(id))) {
        return prev
      }
      return next
    })
    // docTick re-resolves anchors after document changes.
  }, [comments, handle, tintAll, docTick])

  useEffect(() => {
    return () => {
      clearHighlight('comment-anchor')
      clearHighlight('comment-anchor-hot')
      clearHighlight('comment-anchor-flash')
      clearHighlight('comment-anchor-flash-soft')
    }
  }, [])

  const hoverAnchor = useCallback((comment: CommentPayload | null) => {
    const range = comment === null ? null : rangesRef.current.get(comment.id)
    if (range) setHighlight('comment-anchor-hot', [range])
    else clearHighlight('comment-anchor-hot')
  }, [])

  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    const timers = flashTimers.current
    return () => timers.forEach(clearTimeout)
  }, [])

  const jumpToComment = useCallback((comment: CommentPayload) => {
    const range = rangesRef.current.get(comment.id)
    if (!range) return
    // Scroll without touching the ProseMirror selection — a selection
    // transaction would pop the selection toolbar / click-to-comment
    // affordance over the jumped-to text.
    range.startContainer.parentElement?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
    // Pulse: strong tint stepping down to resting — highlight pseudo-elements
    // can't transition, so the fade is two steps (same as the merge pulse).
    flashTimers.current.forEach(clearTimeout)
    setHighlight('comment-anchor-flash', [range])
    flashTimers.current = [
      setTimeout(() => {
        clearHighlight('comment-anchor-flash')
        setHighlight('comment-anchor-flash-soft', [range])
      }, 400),
      setTimeout(() => clearHighlight('comment-anchor-flash-soft'), 1000),
    ]
  }, [])

  return { anchoredIds, hoverAnchor, jumpToComment }
}
