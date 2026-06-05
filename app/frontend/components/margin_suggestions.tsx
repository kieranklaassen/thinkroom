import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorHandle } from '../editor/milkdown_editor'
import type { ProvenanceSpan } from '../editor/provenance'
import { findTextRange, type SuggestionPayload } from '../editor/suggestions'
import { truncate } from '../lib/truncate'

interface Props {
  suggestions: SuggestionPayload[]
  handle: EditorHandle | null
  /** Remeasure signal — updates on every document change. */
  spans: ProvenanceSpan[]
  focusMode: boolean
  onAccept: (suggestion: SuggestionPayload) => void
  onReject: (suggestion: SuggestionPayload) => void
  /** When set, marker taps open this instead of jumping to the anchor —
   *  mobile routes markers into the suggestion sheet. */
  onMarkerSelect?: (suggestion: SuggestionPayload) => void
}

const CARD_GAP = 10

const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS

const anchorOf = (s: SuggestionPayload) => s.replaces ?? s.anchor_text

/** A DOM Range for a ProseMirror position span — for the Custom Highlight API. */
function domRange(view: EditorView, from: number, to: number): Range | null {
  try {
    const start = view.domAtPos(from)
    const end = view.domAtPos(to)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
  } catch {
    return null
  }
}

/**
 * Pending suggestions as cards in the document's right margin, Google-Docs
 * style: each card sits at its anchor's vertical position (same scroll
 * context as the copy, so positions are scroll-stable), stacked downward so
 * cards never overlap. Anchored text is tinted via the CSS Custom Highlight
 * API where available.
 */
export function MarginSuggestions({
  suggestions,
  handle,
  spans,
  focusMode,
  onAccept,
  onReject,
  onMarkerSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<number, HTMLElement>())
  const rangesRef = useRef(new Map<number, Range>())
  const [tops, setTops] = useState(new Map<number, number>())
  // A card animates `top` only once "placed" — flagged a frame after its
  // first measured position paints — so neither initial layout nor a newly
  // arrived card slides in from 0.
  const [placed, setPlaced] = useState<Set<number>>(new Set())
  const [resolving, setResolving] = useState<Set<number>>(new Set())
  const [resizeTick, setResizeTick] = useState(0)

  // Forget per-card flags for suggestions that left the props.
  useEffect(() => {
    const ids = new Set(suggestions.map((s) => s.id))
    const prune = (prev: Set<number>) => {
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    }
    setResolving(prune)
    setPlaced(prune)
  }, [suggestions])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const remeasure = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setResizeTick((t) => t + 1), 150)
    }
    // Images loading into the copy reflow everything below them — anchors
    // move, so positions must be recomputed (load doesn't bubble; capture).
    const onLoad = (event: Event) => {
      if ((event.target as HTMLElement | null)?.tagName === 'IMG') remeasure()
    }
    window.addEventListener('resize', remeasure)
    document.addEventListener('load', onLoad, true)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', remeasure)
      document.removeEventListener('load', onLoad, true)
    }
  }, [])

  // Two-pass measure: cards render, then tops are assigned before paint —
  // desired top is the anchor's y in the shared scroll context, pushed down
  // past the previous card so the stack never overlaps.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !handle) return

    let view: EditorView
    try {
      view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
    } catch {
      return // editor torn down mid-navigation
    }

    const containerTop = container.getBoundingClientRect().top
    const docEnd = Math.max(0, view.state.doc.content.size - 1)
    rangesRef.current = new Map()

    const entries = suggestions.map((s) => {
      const range = findTextRange(view.state.doc, anchorOf(s))
      if (range) {
        const dom = domRange(view, range.from, range.to)
        if (dom) rangesRef.current.set(s.id, dom)
      }
      let top = 0
      try {
        top = view.coordsAtPos(range ? range.from : docEnd).top - containerTop
      } catch {
        top = 0
      }
      return { id: s.id, top: Math.max(0, top) }
    })

    entries.sort((a, b) => a.top - b.top)
    const next = new Map<number, number>()
    let prevBottom = -CARD_GAP
    for (const entry of entries) {
      const height = cardRefs.current.get(entry.id)?.offsetHeight ?? 0
      const top = Math.max(entry.top, prevBottom + CARD_GAP)
      next.set(entry.id, top)
      prevBottom = top + height
    }
    setTops((prev) => {
      if (prev.size === next.size && [...next].every(([id, top]) => prev.get(id) === top)) {
        return prev
      }
      return next
    })

    // Flag fresh cards as placed on the next frame (first top paints first).
    const raf = requestAnimationFrame(() => {
      setPlaced((prev) => {
        if (entries.every((entry) => prev.has(entry.id))) return prev
        const grown = new Set(prev)
        entries.forEach((entry) => grown.add(entry.id))
        return grown
      })
    })

    if (supportsHighlights) {
      CSS.highlights.set('sug-anchor', new Highlight(...rangesRef.current.values()))
    }
    return () => cancelAnimationFrame(raf)
  }, [suggestions, spans, handle, focusMode, resizeTick])

  useEffect(() => {
    if (!supportsHighlights) return
    return () => {
      CSS.highlights.delete('sug-anchor')
      CSS.highlights.delete('sug-anchor-hot')
    }
  }, [])

  const hover = useCallback((id: number | null) => {
    if (!supportsHighlights) return
    const range = id === null ? null : rangesRef.current.get(id)
    if (range) CSS.highlights.set('sug-anchor-hot', new Highlight(range))
    else CSS.highlights.delete('sug-anchor-hot')
  }, [])

  const jumpToSuggestion = useCallback(
    (suggestion: SuggestionPayload) => {
      if (!handle) return
      try {
        handle.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const range = findTextRange(view.state.doc, anchorOf(suggestion))
          if (!range) return
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, range.from, range.to),
          )
          tr.scrollIntoView()
          view.dispatch(tr)
        })
      } catch {
        // editor torn down mid-navigation
      }
    },
    [handle],
  )

  const resolve = (suggestion: SuggestionPayload, action: (s: SuggestionPayload) => void) => {
    // Guard repeat clicks — a second accept would insert the text twice.
    if (resolving.has(suggestion.id)) return
    setResolving((prev) => new Set(prev).add(suggestion.id))
    action(suggestion)
  }

  const setCardRef = (id: number) => (el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el)
    else cardRefs.current.delete(id)
  }

  return (
    <div className="margin-suggestions" ref={containerRef} aria-label="Pending suggestions">
      {suggestions.map((suggestion) => {
        const machine = suggestion.author_kind !== 'human'
        if (focusMode) {
          return (
            <button
              key={suggestion.id}
              ref={setCardRef(suggestion.id)}
              className={`margin-marker ${placed.has(suggestion.id) ? 'is-placed' : ''}`}
              style={{ top: tops.get(suggestion.id) ?? 0 }}
              title={`${machine ? '✦ ' : ''}${suggestion.author_name}${suggestion.intent ? ` — ${suggestion.intent}` : ''}`}
              onMouseEnter={() => hover(suggestion.id)}
              onMouseLeave={() => hover(null)}
              onClick={() =>
                onMarkerSelect ? onMarkerSelect(suggestion) : jumpToSuggestion(suggestion)
              }
            />
          )
        }
        return (
          <div
            key={suggestion.id}
            ref={setCardRef(suggestion.id)}
            className={`margin-card ${placed.has(suggestion.id) ? 'is-placed' : ''}`}
            style={{ top: tops.get(suggestion.id) ?? 0 }}
            onMouseEnter={() => hover(suggestion.id)}
            onMouseLeave={() => hover(null)}
            onClick={() => jumpToSuggestion(suggestion)}
          >
            <div className="suggestion-meta">
              <span className={`author-chip author-chip--${suggestion.author_kind}`}>
                {machine && <span aria-hidden>✦ </span>}
                {suggestion.author_name}
              </span>
              {suggestion.intent && (
                <span className="suggestion-intent">{suggestion.intent}</span>
              )}
            </div>
            {suggestion.replaces && (
              <del className="margin-old">{truncate(suggestion.replaces, 120)}</del>
            )}
            <p className="margin-new">{truncate(suggestion.body, 280)}</p>
            <div className="suggestion-actions">
              <button
                className="btn-accept"
                disabled={resolving.has(suggestion.id)}
                onClick={(event) => {
                  event.stopPropagation()
                  resolve(suggestion, onAccept)
                }}
              >
                Accept
              </button>
              <button
                className="btn-reject"
                disabled={resolving.has(suggestion.id)}
                onClick={(event) => {
                  event.stopPropagation()
                  resolve(suggestion, onReject)
                }}
              >
                Reject
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
