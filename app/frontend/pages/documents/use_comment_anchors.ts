import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { fromRelativePosition, toRelativePosition } from '../../editor/collab_positions'
import { findCommentAnchorRange, type CommentRange } from '../../editor/comment_anchors'
import type { EditorHandle } from '../../editor/milkdown_editor'
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
  anchorRanges: Map<number, CommentRange>
  /** Strong-tint the hovered card's anchor (null clears). */
  hoverAnchor: (comment: CommentPayload | null) => void
  /** Scroll the comment's anchor into view and pulse it. */
  jumpToComment: (comment: CommentPayload) => void
}

/**
 * Connects rail comment cards to the text they discuss. Anchors resolve
 * through the same unique-quote matcher as the composer highlight, then
 * track session-relative positions. Once a bound range changes, it stays
 * orphaned instead of silently moving to another copy of the quote.
 */
export function useCommentAnchors({
  comments,
  handle,
  docTick,
  tintAll,
}: Options): CommentAnchors {
  const rangesRef = useRef(new Map<number, Range>())
  const bindingsRef = useRef(new Map<number, { from: unknown; to: unknown } | null>())
  const boundHandle = useRef(handle)
  const [anchorRanges, setAnchorRanges] = useState(new Map<number, CommentRange>())
  const resolveRange = useCallback((view: EditorView, comment: CommentPayload): CommentRange | null => {
    if (boundHandle.current !== handle) {
      bindingsRef.current.clear()
      boundHandle.current = handle
    }
    const bindings = bindingsRef.current
    if (bindings.has(comment.id)) {
      const binding = bindings.get(comment.id)
      if (!binding) return null
      const from = fromRelativePosition(view.state, binding.from)
      const to = fromRelativePosition(view.state, binding.to)
      if (from !== null && to !== null && from < to && to <= view.state.doc.content.size &&
          view.state.doc.textBetween(from, to, '\n') === comment.anchor_text) return { from, to }
      bindings.set(comment.id, null) // orphaned for this session; never guess again
      return null
    }
    const range = findCommentAnchorRange(view.state.doc, comment.anchor_text)
    if (range) {
      const from = toRelativePosition(view.state, range.from)
      const to = toRelativePosition(view.state, range.to)
      if (from && to) bindings.set(comment.id, { from, to })
    }
    return range
  }, [handle])
  const hoveredIdRef = useRef<number | null>(null)
  const [anchoredIds, setAnchoredIds] = useState<Set<number> | null>(null)

  // Layout effect: an optimistic post must measure before paint, or its
  // card renders one frame in the unlinked state and flickers to linked.
  useLayoutEffect(() => {
    if (!handle) {
      rangesRef.current.clear()
      setAnchoredIds(null)
      setAnchorRanges(new Map())
      return
    }

    let view: EditorView
    try {
      view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
    } catch {
      return // editor torn down mid-navigation
    }

    const ranges = new Map<number, Range>()
    const positions = new Map<number, CommentRange>()
    const currentIds = new Set(comments.map((comment) => comment.id))
    for (const id of bindingsRef.current.keys()) {
      if (!currentIds.has(id)) bindingsRef.current.delete(id)
    }
    for (const comment of comments) {
      if (comment.resolved || !comment.anchor_text) continue
      const range = resolveRange(view, comment)
      const dom = range ? domRange(view, range.from, range.to) : null
      if (dom && range) { ranges.set(comment.id, dom); positions.set(comment.id, range) }
    }
    rangesRef.current = ranges
    setAnchorRanges(positions)
    flashTimers.current.forEach(clearTimeout)
    flashTimers.current.length = 0
    clearHighlight('comment-anchor-flash')
    clearHighlight('comment-anchor-flash-soft')

    setHighlight('comment-anchor', tintAll ? [...ranges.values()] : [])
    // Re-derive the hover spotlight from the fresh ranges: edits move the
    // anchor under a hovered card, and resolving a hovered card unmounts it
    // without ever firing mouseleave.
    const hovered = hoveredIdRef.current === null ? null : ranges.get(hoveredIdRef.current)
    if (hovered) setHighlight('comment-anchor-hot', [hovered])
    else clearHighlight('comment-anchor-hot')
    setAnchoredIds((prev) => {
      const next = new Set(ranges.keys())
      if (prev && prev.size === next.size && [...next].every((id) => prev.has(id))) {
        return prev
      }
      return next
    })
    // docTick re-resolves anchors after document changes.
  }, [comments, handle, tintAll, docTick, resolveRange])

  useEffect(() => {
    return () => {
      clearHighlight('comment-anchor')
      clearHighlight('comment-anchor-hot')
      clearHighlight('comment-anchor-flash')
      clearHighlight('comment-anchor-flash-soft')
    }
  }, [])

  const hoverAnchor = useCallback((comment: CommentPayload | null) => {
    hoveredIdRef.current = comment === null ? null : comment.id
    const range = comment === null ? null : rangesRef.current.get(comment.id)
    if (range) setHighlight('comment-anchor-hot', [range])
    else clearHighlight('comment-anchor-hot')
  }, [])

  // Mutated in place (never reassigned) so the unmount cleanup's captured
  // reference always sees the live timers.
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    const timers = flashTimers.current
    return () => timers.forEach(clearTimeout)
  }, [])

  const jumpToComment = useCallback((comment: CommentPayload) => {
    if (!handle || comment.resolved) return
    let range: Range | null = null
    try {
      const view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
      const position = resolveRange(view, comment)
      if (position) range = domRange(view, position.from, position.to)
    } catch { return }
    if (!range) return
    // Scroll without touching the ProseMirror selection — a selection
    // transaction would pop the selection toolbar / click-to-comment
    // affordance over the jumped-to text. For an anchor starting at a block
    // boundary, domAtPos returns the block element itself (not its text
    // node) — its parentElement would be the editor root and "center" would
    // scroll to the middle of the whole document.
    const start = range.startContainer
    const startEl = start instanceof Element ? start : start.parentElement
    startEl?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
    // Pulse: strong tint stepping down to resting — highlight pseudo-elements
    // can't transition, so the fade is two steps (same as the merge pulse).
    flashTimers.current.forEach(clearTimeout)
    flashTimers.current.length = 0
    setHighlight('comment-anchor-flash', [range])
    flashTimers.current.push(
      setTimeout(() => {
        clearHighlight('comment-anchor-flash')
        setHighlight('comment-anchor-flash-soft', [range])
      }, 400),
      setTimeout(() => clearHighlight('comment-anchor-flash-soft'), 1000),
    )
  }, [handle, resolveRange])

  return { anchoredIds, anchorRanges, hoverAnchor, jumpToComment }
}
