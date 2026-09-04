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

import { CommentCard } from './comment_card'
import type { CommentPayload } from '../types/payloads'
import type { CommentRange } from '../editor/comment_anchors'

interface Props {
  comments: CommentPayload[]
  anchorRanges: Map<number, CommentRange>
  onResolveComment: (comment: CommentPayload) => void
  onJumpToComment: (comment: CommentPayload) => void
  onHoverComment: (comment: CommentPayload | null) => void
  onCommentMarkerSelect: (comment: CommentPayload) => void
  resolvingComments?: Set<number>
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
export function MarginAnnotations({ items, comments, anchorRanges, handle, focusMode, onMarkerSelect, onResolveComment, onJumpToComment, onHoverComment, onCommentMarkerSelect, resolvingComments }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rangesRef = useRef(new Map<string, Range>())

  let layoutElement: HTMLElement | null = null
  try { layoutElement = handle?.editor.action((ctx) => ctx.get(editorViewCtx).dom) ?? null } catch { /* editor unmount */ }
  const { tops, placed, setCardRef, height } = useMarginStack<string>(() => {
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

    for (const comment of comments) {
      const range = anchorRanges.get(comment.id)
      if (!range) continue
      try {
        entries.push({ key: `comment:${comment.id}`, top: Math.max(0, view.coordsAtPos(range.from).top - containerTop) })
      } catch { /* remeasured after the next document change */ }
    }
    setHighlight('sug-anchor', [...rangesRef.current.values()])
    return entries
  }, [items, comments, anchorRanges, handle, focusMode], layoutElement)

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
    <div className="margin-annotations" style={{ minHeight: height }} ref={containerRef} aria-label="Document annotations">
      {comments.map((comment) => {
        const key = `comment:${comment.id}`
        return focusMode ? (
          <button key={key} ref={setCardRef(key)}
            className={`margin-marker margin-marker--comment ${placed.has(key) ? 'is-placed' : ''}`}
            style={{ top: tops.get(key) ?? 0 }}
            aria-label={`Comment by ${comment.author_name}: ${comment.body}`}
            title={`Comment by ${comment.author_name}`}
            onClick={() => onCommentMarkerSelect(comment)} />
        ) : (
          <div key={key} ref={setCardRef(key)} className={`margin-comment ${placed.has(key) ? 'is-placed' : ''}`}
            style={{ top: tops.get(key) ?? 0 }}>
            <CommentCard comment={comment} linked measured onResolve={onResolveComment}
              onJumpTo={onJumpToComment} onHover={onHoverComment} resolving={resolvingComments?.has(comment.id)} />
          </div>
        )
      })}
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
