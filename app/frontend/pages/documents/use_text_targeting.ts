import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorHandle } from '../../editor/milkdown_editor'
import {
  aiSpanAt,
  applyReviewState,
  bindReviewTarget,
  resolveReviewTarget,
  nextProvenanceRange,
  type AiSpan,
  type ProvenanceFilter,
  type ReviewState,
} from '../../editor/provenance'
import type { EditorMode } from '../../components/mode_control'
import { clearHighlight, domRange, setHighlight } from '../../lib/highlights'
import type { OwnershipPayload } from '../../types/payloads'
import type { TextTarget } from './use_floating_chrome'
import type { useSuggestionReview } from './use_suggestion_review'

// Server-side anchor cap is 10 KB; a truncated anchor still matches as a
// prefix within the block (findTextRange matches the exact search string).
// Single encode + byte slice; a byte-boundary cut mid-codepoint decodes to
// a trailing U+FFFD that would break prefix matching, so strip it.
const ANCHOR_BYTE_CAP = 10 * 1024
const capAnchor = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= ANCHOR_BYTE_CAP) return text
  return new TextDecoder().decode(bytes.slice(0, ANCHOR_BYTE_CAP)).replace(/�+$/, '')
}

interface Options {
  viewRef: RefObject<EditorView | null>
  handleRef: RefObject<EditorHandle | null>
  modeRef: RefObject<EditorMode>
  ownershipRef: RefObject<OwnershipPayload>
  textTarget: TextTarget | null
  setTextTarget: Dispatch<SetStateAction<TextTarget | null>>
  reviewItems: ReturnType<typeof useSuggestionReview>['items']
  isMobile: boolean
  openSuggestionSheet: (key: string) => void
}

interface TextTargeting {
  reviewNotice: string
  handleSelection: (view: EditorView, cause?: 'selection' | 'document') => void
  closeReview: () => void
  navigateProvenance: (filter: ProvenanceFilter, trigger: HTMLButtonElement, keyboard: boolean) => void
  handleAdvance: (state: ReviewState) => void
}

/** Which passage the floating chrome belongs to: chosen by selecting,
 *  tapping, or stepping through provenance, and dropped by clicking away. */
export function useTextTargeting({
  viewRef,
  handleRef,
  modeRef,
  ownershipRef,
  textTarget,
  setTextTarget,
  reviewItems,
  isMobile,
  openSuggestionSheet,
}: Options): TextTargeting {
  const textTargetRef = useRef(textTarget)
  textTargetRef.current = textTarget
  const reviewTrigger = useRef<HTMLElement | null>(null)
  const navigatingReview = useRef(false)
  const [reviewNotice, setReviewNotice] = useState('')
  const reviewItemsRef = useRef(reviewItems)
  reviewItemsRef.current = reviewItems
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  // Priority-ordered dispatch: text selection → mobile suggestion tap →
  // click-to-comment → AI review span. Exactly one target (or none) comes
  // out — the single textTarget cell makes that mutual exclusion structural.
  const handleSelection = useCallback((view: EditorView, cause: 'selection' | 'document' = 'selection') => {
    viewRef.current = view
    if (navigatingReview.current || modeRef.current === 'read') return
    if (cause === 'document') {
      const current = textTargetRef.current
      if (current?.kind === 'review') {
        if (!resolveReviewTarget(view.state, current.target)) {
          setTextTarget(null)
          setReviewNotice('That passage changed. Choose text to review again.')
        }
        return
      }
      // A remote edit or undo must not reopen dismissed guidance.
      if (!current) return
    }
    setReviewNotice('')
    reviewTrigger.current = null
    const { from, to, empty } = view.state.selection

    // Only require focus when the view is editable: in Comment mode the
    // root is contenteditable=false, which browsers never focus, so
    // hasFocus() is always false and the focus gate would make the selection
    // toolbar unreachable in the read-only mode.
    if (view.editable && !view.hasFocus()) {
      setTextTarget(null)
      return
    }

    if (!empty) {
      const text = view.state.doc.textBetween(from, to, '\n')
      if (text.trim().length > 0) {
        setTextTarget({ kind: 'selection', text })
        return
      }
    }

    // Mobile: tapping inside a pending suggestion's tinted anchor opens its
    // sheet card — the touch equivalent of glancing at the margin. The
    // review items carry ranges from the same parser-aware matcher the
    // cards anchor with, resolved once per doc version, so this is a plain
    // containment check instead of per-suggestion document scans.
    if (isMobileRef.current && empty) {
      const pos = view.state.selection.head
      const hit = reviewItemsRef.current.find(
        (item) =>
          !item.inline && item.range && pos >= item.range.from && pos <= item.range.to,
      )
      if (hit) {
        openSuggestionSheet(hit.key)
        setTextTarget(null)
        return
      }
    }

    // Comment mode: a bare click offers commenting on the clicked block —
    // no drag-selection needed (Google-Docs click-to-comment). Only
    // non-empty textblocks; clicks on empty paragraphs, images, or rules
    // show nothing. Selection-based commenting above keeps working.
    if (modeRef.current === 'comment' && empty) {
      const block = view.state.selection.$head.parent
      const text = block.isTextblock ? block.textContent : ''
      if (text.trim().length > 0) {
        setTextTarget({ kind: 'comment', text: capAnchor(text) })
        return
      }
    }

    const span = aiSpanAt(view.state)
    const target = span ? bindReviewTarget(view.state, span) : null
    setTextTarget(target ? { kind: 'review', target, keyboard: false } : null)
  }, [modeRef, openSuggestionSheet, setTextTarget, viewRef])

  // Review/selection chrome belongs to the text that opened it. ProseMirror
  // does not dispatch a selection transaction when focus moves to page
  // chrome, so explicitly clear these transient targets on outside clicks.
  // Keep clicks on the floating chrome itself alive so its actions still run.
  useEffect(() => {
    let editorClickRaf = 0
    const clearTextTarget = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.milkdown .ProseMirror')) {
        // A dismissed popover leaves ProseMirror's cursor where it was. A
        // second click on that exact span therefore produces no selection
        // transaction, so explicitly re-evaluate provenance after the click.
        if (target.closest('[data-provenance]')) {
          if (editorClickRaf) cancelAnimationFrame(editorClickRaf)
          editorClickRaf = requestAnimationFrame(() => {
            editorClickRaf = 0
            // Not viewRef: a first click where the cursor already starts
            // reports no selection, so viewRef can still be null here.
            try {
              const view = handleRef.current?.editor.action((ctx) => ctx.get(editorViewCtx))
              if (view) handleSelection(view)
            } catch {
              // editor torn down mid-navigation
            }
          })
        }
        return
      }
      if (
        target.closest('.selection-toolbar, .review-popover, .comment-composer--anchored, .prov-summary')
      ) {
        return
      }

      setTextTarget(null)
    }

    window.addEventListener('pointerdown', clearTextTarget, true)
    return () => {
      if (editorClickRaf) cancelAnimationFrame(editorClickRaf)
      window.removeEventListener('pointerdown', clearTextTarget, true)
    }
  }, [handleRef, handleSelection, setTextTarget])

  const closeReview = useCallback(() => {
    setTextTarget(null)
    textTargetRef.current = null
    clearHighlight('review-target')
    const trigger = reviewTrigger.current
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    else viewRef.current?.focus()
  }, [setTextTarget, viewRef])

  const navigateProvenance = useCallback((filter: ProvenanceFilter, trigger: HTMLButtonElement, keyboard: boolean) => {
    const handle = handleRef.current
    if (!handle || modeRef.current === 'read') return
    const view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
    viewRef.current = view
    const span = nextProvenanceRange(view.state, filter)
    clearHighlight('review-target')
    if (!span) {
      setTextTarget(null)
      textTargetRef.current = null
      setReviewNotice(filter === 'unreviewed'
        ? 'All caught up — no unreviewed AI text.'
        : `No ${filter === 'human' ? 'human' : 'AI'} text in this document.`)
      return
    }
    const target = span.attrs.kind === 'ai' ? bindReviewTarget(view.state, span) : null
    navigatingReview.current = true
    view.focus()
    // Reveal the beginning, not the far end of a multi-screen passage.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, span.to, span.from)).scrollIntoView())
    const start = view.coordsAtPos(span.from)
    window.scrollBy({ top: start.top - Math.min(300, window.innerHeight * 0.4), behavior: 'instant' })
    navigatingReview.current = false
    reviewTrigger.current = trigger
    const next: TextTarget | null = target ? { kind: 'review', target, keyboard } : null
    textTargetRef.current = next
    setTextTarget(next)
    setReviewNotice(span.attrs.kind === 'human' ? 'Human-written passage selected.' : '')
    if (!target) trigger.focus({ preventScroll: true })
  }, [handleRef, modeRef, setTextTarget, viewRef])

  const handleAdvance = useCallback((state: ReviewState) => {
    const view = viewRef.current
    const current = textTargetRef.current
    if (!view || current?.kind !== 'review' || modeRef.current !== 'edit' || !ownershipRef.current.can_write) return
    const span = resolveReviewTarget(view.state, current.target)
    if (!span) {
      setTextTarget(null)
      setReviewNotice('That passage changed. Choose text to review again.')
      return
    }
    applyReviewState(view, span, state)
  }, [modeRef, ownershipRef, setTextTarget, viewRef])

  return { reviewNotice, handleSelection, closeReview, navigateProvenance, handleAdvance }
}

/** Tints the passage under review while its popover is up; Escape closes it. */
export function useReviewHighlight({
  viewRef,
  textTarget,
  reviewActive,
  liveReviewSpan,
  docTick,
  closeReview,
}: {
  viewRef: RefObject<EditorView | null>
  textTarget: TextTarget | null
  reviewActive: boolean
  liveReviewSpan: AiSpan | null
  docTick: number
  closeReview: () => void
}): void {
  useEffect(() => {
    const view = viewRef.current
    const range = reviewActive && liveReviewSpan && view ? domRange(view, liveReviewSpan.from, liveReviewSpan.to) : null
    setHighlight('review-target', range ? [range] : [])
    return () => clearHighlight('review-target')
  }, [viewRef, reviewActive, liveReviewSpan, docTick])

  useEffect(() => {
    if (textTarget?.kind !== 'review') return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      closeReview()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [textTarget, closeReview])
}
