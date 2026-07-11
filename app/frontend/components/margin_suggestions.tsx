import { useCallback, useEffect, useRef } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorHandle } from '../editor/milkdown_editor'
import { clearHighlight, domRange, setHighlight, supportsHighlights } from '../lib/highlights'
import { useMarginStack } from '../lib/use_margin_stack'
import {
  SuggestionCardBody,
  useResolveGuard,
  type ReviewableSuggestion,
} from './suggestion_card'

interface Props {
  /** Server rows and doc-native tracked edits, ranges pre-resolved per doc
   *  version (useSuggestionReview) — new array identity is the remeasure
   *  signal for local AND remote document changes. */
  items: ReviewableSuggestion[]
  handle: EditorHandle | null
  focusMode: boolean
  /** When set, marker taps on server rows open this instead of jumping to
   *  the anchor — mobile routes markers into the suggestion sheet. Tracked
   *  edits always jump (their marks are visible in the copy). */
  onMarkerSelect?: (item: ReviewableSuggestion) => void
}

/**
 * Pending review items as cards in the document's right margin, Google-Docs
 * style: each card sits at its anchor's vertical position (same scroll
 * context as the copy, so positions are scroll-stable), stacked downward in
 * one shared stack so cards never overlap. Server-row anchors are tinted via
 * the CSS Custom Highlight API where available; tracked edits are already
 * tinted by their marks.
 */
export function MarginSuggestions({ items, handle, focusMode, onMarkerSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rangesRef = useRef(new Map<string, Range>())

  const { tops, placed, setCardRef } = useMarginStack<string>(() => {
    const container = containerRef.current
    if (!container || !handle) return null

    let view: EditorView
    try {
      view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
    } catch {
      return null // editor torn down mid-navigation
    }

    const containerTop = container.getBoundingClientRect().top
    const docSize = view.state.doc.content.size
    const docEnd = Math.max(0, docSize - 1)
    rangesRef.current = new Map()

    const entries = items.map((item) => {
      const range = item.range
      if (range && !item.inline) {
        const dom = domRange(view, Math.min(range.from, docSize), Math.min(range.to, docSize))
        if (dom) rangesRef.current.set(item.key, dom)
      }
      let top: number
      try {
        top = view.coordsAtPos(range ? Math.min(range.from, docSize) : docEnd).top - containerTop
      } catch {
        top = 0
      }
      return { key: item.key, top: Math.max(0, top) }
    })

    setHighlight('sug-anchor', [...rangesRef.current.values()])
    return entries
  }, [items, handle, focusMode])

  useEffect(() => {
    if (!supportsHighlights) return
    return () => {
      clearHighlight('sug-anchor')
      clearHighlight('sug-anchor-hot')
    }
  }, [])

  const hover = useCallback((key: string | null) => {
    const range = key === null ? null : rangesRef.current.get(key)
    if (range) setHighlight('sug-anchor-hot', [range])
    else clearHighlight('sug-anchor-hot')
  }, [])

  const jumpTo = useCallback(
    (item: ReviewableSuggestion) => {
      if (!handle || !item.range) return
      const { from, to } = item.range
      try {
        handle.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const max = view.state.doc.content.size
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, Math.min(from, max), Math.min(to, max)),
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

  const { resolving, resolve } = useResolveGuard(items)

  return (
    <div className="margin-suggestions" ref={containerRef} aria-label="Pending suggestions">
      {items.map((item) => {
        if (focusMode) {
          return (
            <button
              key={item.key}
              ref={setCardRef(item.key)}
              className={`margin-marker ${item.inline ? 'margin-marker--inline ' : ''}${placed.has(item.key) ? 'is-placed' : ''}`}
              style={{ top: tops.get(item.key) ?? 0 }}
              title={item.markerTitle}
              onMouseEnter={() => hover(item.key)}
              onMouseLeave={() => hover(null)}
              onClick={() =>
                onMarkerSelect && !item.inline ? onMarkerSelect(item) : jumpTo(item)
              }
            />
          )
        }
        return (
          <div
            key={item.key}
            ref={setCardRef(item.key)}
            data-suggestion-key={item.key}
            className={`margin-card ${item.inline ? 'margin-card--inline ' : ''}${placed.has(item.key) ? 'is-placed' : ''}`}
            style={{ top: tops.get(item.key) ?? 0 }}
            onMouseEnter={() => hover(item.key)}
            onMouseLeave={() => hover(null)}
            onClick={() => jumpTo(item)}
          >
            <SuggestionCardBody
              item={item}
              oldLimit={120}
              newLimit={280}
              disabled={resolving.has(item.key)}
              onResolve={resolve}
            />
          </div>
        )
      })}
    </div>
  )
}
