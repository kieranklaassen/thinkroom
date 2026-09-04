import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { CommentRange } from '../../editor/comment_anchors'
import { aiSpanAt, type AiSpan, type ProvenanceSpan } from '../../editor/provenance'
import {
  useAnchoredPopover,
  type AnchoredPosition,
} from '../../lib/use_anchored_popover'

// Floating chrome stores only its anchor identity; geometry is re-derived
// from the live editor state on scroll / resize / doc updates, so popovers
// track their text instead of freezing at birth coordinates. One state cell
// holds whichever text-anchored affordance is open — the mutual exclusion
// between them is structural, not hand-cleared.
export type TextTarget =
  | { kind: 'selection'; text: string }
  // Click-to-comment (Comment mode): the clicked block's text, anchored at
  // the click's collapsed selection.
  | { kind: 'comment'; text: string }
  | { kind: 'review'; span: AiSpan }

interface Options {
  viewRef: RefObject<EditorView | null>
  textTarget: TextTarget | null
  composerAnchor: string | null
  composerOpen: boolean
  getComposerRange: () => CommentRange | null
  /** One floating form at a time: an open composer suppresses the selection
   *  chrome, and so does the share popover (z-60, above the chrome's z-50). */
  chromeSuppressed: boolean
  spans: ProvenanceSpan[]
  docTick: number
  isMobile: boolean
}

interface Popover<T extends HTMLElement> {
  ref: RefObject<T | null>
  position: AnchoredPosition | null
}

export interface FloatingChrome {
  selectionToolbarActive: boolean
  selectionPopover: Popover<HTMLDivElement>
  commentAffordanceActive: boolean
  commentAffordance: Popover<HTMLDivElement>
  liveReviewSpan: AiSpan | null
  reviewActive: boolean
  reviewPopover: Popover<HTMLDivElement>
  composerPopover: Popover<HTMLFormElement>
}

/** Measured, selection-centered placement for the page's floating chrome:
 *  the selection toolbar, the click-to-comment affordance, the AI review
 *  popover, and the anchored comment composer. */
export function useFloatingChrome({
  viewRef,
  textTarget,
  composerAnchor,
  composerOpen,
  getComposerRange,
  chromeSuppressed,
  spans,
  docTick,
  isMobile,
}: Options): FloatingChrome {
  // While a popover is open, any scroll or resize schedules one rAF-throttled
  // reposition pass (coordsAtPos for a single anchor is cheap).
  const [popoverTick, setPopoverTick] = useState(0)
  const popoverOpen = Boolean(textTarget) || composerAnchor !== null
  useEffect(() => {
    if (!popoverOpen) return
    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setPopoverTick((tick) => tick + 1)
      })
    }
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [popoverOpen])

  // Mouse-drag gating: selection chrome stays hidden while the primary
  // button is down so the toolbar doesn't chase the cursor mid-drag; it
  // reveals once on release at the settled position. Keyboard selections
  // reveal immediately (no pointer down). Pointerdowns on the chrome itself
  // are exempt so pressing a toolbar button doesn't hide it mid-click.
  const [pointerHeld, setPointerHeld] = useState(false)
  useEffect(() => {
    const onChrome = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('.selection-toolbar, .review-popover, .comment-composer--anchored'))
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || onChrome(event.target)) return
      setPointerHeld(true)
    }
    const up = () => setPointerHeld(false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('blur', up)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', up)
    }
  }, [])

  const popoverGap = isMobile ? 20 : 8

  const selectionToolbarActive =
    textTarget?.kind === 'selection' && !pointerHeld && !chromeSuppressed
  const selectionPopover = useAnchoredPopover<HTMLDivElement>({
    active: selectionToolbarActive,
    getView: () => viewRef.current,
    getRange: () => {
      const view = viewRef.current
      if (!view || view.state.selection.empty) return null
      return { from: view.state.selection.from, to: view.state.selection.to }
    },
    gap: popoverGap,
    deps: [textTarget, spans, popoverTick],
  })

  const commentAffordanceActive =
    textTarget?.kind === 'comment' && !pointerHeld && !chromeSuppressed
  const commentAffordance = useAnchoredPopover<HTMLDivElement>({
    active: commentAffordanceActive,
    getView: () => viewRef.current,
    getRange: () => {
      const view = viewRef.current
      if (!view) return null
      const head = view.state.selection.head
      return { from: head, to: head }
    },
    gap: popoverGap,
    deps: [textTarget, spans, popoverTick],
  })

  // Re-derive the span from current state: edits shift positions, and
  // advancing the review state changes the attrs the popover renders.
  const liveReviewSpan = useMemo(() => {
    if (textTarget?.kind !== 'review') return null
    const view = viewRef.current
    if (!view) return null
    return aiSpanAt(view.state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textTarget, spans, popoverTick])
  const reviewActive = Boolean(liveReviewSpan) && !pointerHeld && !chromeSuppressed
  const reviewPopover = useAnchoredPopover<HTMLDivElement>({
    active: reviewActive,
    getView: () => viewRef.current,
    getRange: () => {
      const view = viewRef.current
      if (!view) return null
      const span = aiSpanAt(view.state)
      return span ? { from: span.from, to: span.to } : null
    },
    gap: popoverGap,
    deps: [textTarget, spans, popoverTick],
  })

  // Keep the whole boundary textblocks readable, not only the selected word:
  // a composer below the first line can otherwise cover its wrapped paragraph.
  // If a remote edit removes the anchor it freezes in
  // place (detached) instead of vanishing mid-draft.
  const composerPopover = useAnchoredPopover<HTMLFormElement>({
    active: composerOpen,
    getView: () => viewRef.current,
    getRange: () => {
      const range = getComposerRange()
      const view = viewRef.current
      if (!range || !view) return null
      const start = view.state.doc.resolve(range.from)
      const end = view.state.doc.resolve(range.to)
      return {
        from: start.parent.isTextblock ? start.start() : range.from,
        to: end.parent.isTextblock ? end.end() : range.to,
      }
    },
    preferBelow: true,
    persistent: true,
    gap: popoverGap,
    deps: [composerAnchor, spans, popoverTick, docTick],
  })

  return {
    selectionToolbarActive,
    selectionPopover,
    commentAffordanceActive,
    commentAffordance,
    liveReviewSpan,
    reviewActive,
    reviewPopover,
    composerPopover,
  }
}
