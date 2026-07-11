import { useEffect, useState } from 'react'
import { nativeHaptic } from '@ruby-native/react'
import { truncate } from '../lib/truncate'
import type { AuthorKind } from '../types/payloads'

/**
 * One review surface, two sources: server suggestion rows (agent proposals
 * over the API) and doc-native tracked edits (Suggest-mode typing). Both map
 * into this view model so the margin cards, focus-mode markers, and the
 * mobile sheet render a single card family instead of parallel components.
 */
export interface ReviewableSuggestion {
  /** Unique across both sources: `row-{id}` or `inline-{markId}`. */
  key: string
  authorName: string
  /** author-chip CSS modifier. */
  chipKind: AuthorKind
  /** '✦' machine proposal, '✎' tracked edit, null for plain human rows. */
  glyph: string | null
  intent: string | null
  oldText: string | null
  newText: string | null
  /** False while an optimistic placeholder has no server row yet — a
   *  resolve PATCH against it would 404, so actions stay hidden. */
  canResolve: boolean
  /** Doc-native tracked edit (green insertion family) vs suggestion row. */
  inline: boolean
  /** Focus-mode marker tooltip. */
  markerTitle: string
  /** Where the target text lives in the live doc; null when unresolvable
   *  (the card then anchors at the document end). */
  range: { from: number; to: number } | null
  accept: () => void
  reject: () => void
}

/** Guard repeat clicks per card — a second accept of a server row would
 *  insert the text twice. Keys are forgotten when their item leaves. */
export function useResolveGuard(items: ReviewableSuggestion[]): {
  resolving: Set<string>
  resolve: (item: ReviewableSuggestion, action: () => void) => void
} {
  const [resolving, setResolving] = useState<Set<string>>(new Set())

  useEffect(() => {
    setResolving((prev) => {
      const keys = new Set(items.map((item) => item.key))
      const next = new Set([...prev].filter((key) => keys.has(key)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const resolve = (item: ReviewableSuggestion, action: () => void) => {
    if (resolving.has(item.key)) return
    setResolving((prev) => new Set(prev).add(item.key))
    action()
  }

  return { resolving, resolve }
}

interface BodyProps {
  item: ReviewableSuggestion
  oldLimit: number
  newLimit: number
  disabled: boolean
  onResolve: (item: ReviewableSuggestion, action: () => void) => void
}

/** The card interior shared by margin cards and sheet cards: author meta,
 *  old/new text, and the Accept/Reject actions. Containers differ per
 *  surface (positioned div in the margin, li in the sheet). */
export function SuggestionCardBody({ item, oldLimit, newLimit, disabled, onResolve }: BodyProps) {
  return (
    <>
      <div className="suggestion-meta">
        <span className={`author-chip author-chip--${item.chipKind}`}>
          {item.glyph && <span aria-hidden>{item.glyph} </span>}
          {item.authorName}
        </span>
        {item.intent && <span className="suggestion-intent">{item.intent}</span>}
      </div>
      {item.oldText && <del className="margin-old">{truncate(item.oldText, oldLimit)}</del>}
      {item.newText && <p className="margin-new">{truncate(item.newText, newLimit)}</p>}
      {item.canResolve && (
        <div className="suggestion-actions">
          <button
            className="btn-accept"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              onResolve(item, item.accept)
            }}
            {...nativeHaptic('success')}
          >
            Accept
          </button>
          <button
            className="btn-reject"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              onResolve(item, item.reject)
            }}
            {...nativeHaptic('warning')}
          >
            Reject
          </button>
        </div>
      )}
    </>
  )
}
