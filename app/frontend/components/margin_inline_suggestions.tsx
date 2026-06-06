import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorHandle } from '../editor/milkdown_editor'
import type { ProvenanceSpan } from '../editor/provenance'
import {
  acceptInlineSuggestion,
  rejectInlineSuggestion,
  type InlineSuggestion,
} from '../editor/suggest_changes'
import { flashMergedRange } from '../editor/suggestions'
import { truncate } from '../lib/truncate'

interface Props {
  inline: InlineSuggestion[]
  handle: EditorHandle | null
  /** Remeasure signal — updates on every document change. */
  spans: ProvenanceSpan[]
  focusMode: boolean
}

const CARD_GAP = 10

/**
 * Margin cards for doc-native tracked edits (Suggest-mode typing). Sibling
 * of MarginSuggestions, not an extension — these position by the marks'
 * exact positions (`coordsAtPos(from)`, no text matching, so duplicated
 * text can't mis-anchor) and resolve via local ProseMirror commands that
 * sync through Yjs (no server round-trip). Shares the margin-card CSS
 * skeleton with a distinct tracked-edit treatment.
 */
export function MarginInlineSuggestions({ inline, handle, spans, focusMode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const [tops, setTops] = useState(new Map<string, number>())
  const [placed, setPlaced] = useState<Set<string>>(new Set())

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
    const entries = inline.map((s) => {
      let top = 0
      try {
        top = view.coordsAtPos(Math.min(s.from, view.state.doc.content.size)).top - containerTop
      } catch {
        top = 0
      }
      return { id: s.id, top: Math.max(0, top) }
    })

    entries.sort((a, b) => a.top - b.top)
    const next = new Map<string, number>()
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

    const raf = requestAnimationFrame(() => {
      setPlaced((prev) => {
        if (entries.every((entry) => prev.has(entry.id))) return prev
        const grown = new Set(prev)
        entries.forEach((entry) => grown.add(entry.id))
        return grown
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [inline, spans, handle, focusMode])

  const jumpTo = useCallback(
    (s: InlineSuggestion) => {
      if (!handle) return
      try {
        handle.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const max = view.state.doc.content.size
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, Math.min(s.from, max), Math.min(s.to, max)),
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

  // No resolving-state guard needed: resolve is idempotent (the command
  // re-checks the id and no-ops when the marks are already gone), and the
  // card unmounts synchronously with the doc change it causes.
  const resolve = useCallback(
    (s: InlineSuggestion, accept: boolean) => {
      if (!handle) return
      try {
        handle.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const acted = accept
            ? acceptInlineSuggestion(view, s.id)
            : rejectInlineSuggestion(view, s.id)
          // Flash only the pure-insertion accept: mark removal preserves
          // positions, so the snapshot range is still valid. Deletion and
          // mixed accepts remove text, leaving s.from/s.to stale.
          if (acted && accept && s.insertedText && !s.deletedText) {
            const max = view.state.doc.content.size
            flashMergedRange(handle.editor, {
              from: Math.min(s.from, max),
              to: Math.min(s.to, max),
            })
          }
        })
      } catch {
        // editor torn down mid-navigation
      }
    },
    [handle],
  )

  if (inline.length === 0) return null

  return (
    <div
      className="margin-suggestions margin-suggestions--inline"
      ref={containerRef}
      aria-label="Pending tracked edits"
    >
      {inline.map((s) => {
        if (focusMode) {
          return (
            <button
              key={s.id}
              ref={(el) => {
                if (el) cardRefs.current.set(s.id, el)
                else cardRefs.current.delete(s.id)
              }}
              className={`margin-marker margin-marker--inline ${placed.has(s.id) ? 'is-placed' : ''}`}
              style={{ top: tops.get(s.id) ?? 0 }}
              title={`✎ ${s.author || 'Someone'} suggested an edit`}
              onClick={() => jumpTo(s)}
            />
          )
        }
        return (
          <div
            key={s.id}
            ref={(el) => {
              if (el) cardRefs.current.set(s.id, el)
              else cardRefs.current.delete(s.id)
            }}
            className={`margin-card margin-card--inline ${placed.has(s.id) ? 'is-placed' : ''}`}
            style={{ top: tops.get(s.id) ?? 0 }}
            onClick={() => jumpTo(s)}
          >
            <div className="suggestion-meta">
              <span className="author-chip author-chip--human">
                <span aria-hidden>✎ </span>
                {s.author || 'Someone'}
              </span>
              <span className="suggestion-intent">Suggested edit</span>
            </div>
            {s.deletedText && <del className="margin-old">{truncate(s.deletedText, 120)}</del>}
            {s.insertedText && <p className="margin-new">{truncate(s.insertedText, 280)}</p>}
            <div className="suggestion-actions">
              <button
                className="btn-accept"
                onClick={(event) => {
                  event.stopPropagation()
                  resolve(s, true)
                }}
              >
                Accept
              </button>
              <button
                className="btn-reject"
                onClick={(event) => {
                  event.stopPropagation()
                  resolve(s, false)
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

interface SheetProps {
  inline: InlineSuggestion[]
  handle: EditorHandle | null
}

/** Mobile review surface for tracked edits — a section above the server-row
 *  suggestion list inside the suggestions sheet. */
export function InlineSuggestionSheetList({ inline, handle }: SheetProps) {
  const resolve = (s: InlineSuggestion, accept: boolean) => {
    if (!handle) return
    try {
      handle.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        if (accept) acceptInlineSuggestion(view, s.id)
        else rejectInlineSuggestion(view, s.id)
      })
    } catch {
      // editor torn down mid-navigation
    }
  }

  if (inline.length === 0) return null

  return (
    <ul className="sheet-suggestions sheet-suggestions--inline" aria-label="Pending tracked edits">
      {inline.map((s) => (
        <li key={s.id} className="sheet-card sheet-card--inline">
          <div className="suggestion-meta">
            <span className="author-chip author-chip--human">
              <span aria-hidden>✎ </span>
              {s.author || 'Someone'}
            </span>
            <span className="suggestion-intent">Suggested edit</span>
          </div>
          {s.deletedText && <del className="margin-old">{truncate(s.deletedText, 160)}</del>}
          {s.insertedText && <p className="margin-new">{truncate(s.insertedText, 400)}</p>}
          <div className="suggestion-actions">
            <button className="btn-accept" onClick={() => resolve(s, true)}>
              Accept
            </button>
            <button className="btn-reject" onClick={() => resolve(s, false)}>
              Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
