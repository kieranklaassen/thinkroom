import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SuggestionPayload } from '../editor/suggestions'
import { truncate } from '../lib/truncate'

export type SheetKind = 'suggestions' | 'comments' | 'activity'

interface DockProps {
  suggestionCount: number
  commentCount: number
  active: SheetKind | null
  onOpen: (kind: SheetKind) => void
}

/** Compact bottom action bar — the mobile home for everything the desktop
 *  rail and margin gutter carry. Each item opens a bottom sheet. */
export function MobileDock({ suggestionCount, commentCount, active, onOpen }: DockProps) {
  const item = (kind: SheetKind, label: ReactNode, count: number) => (
    <button
      className={`dock-item ${active === kind ? 'is-active' : ''}`}
      aria-pressed={active === kind}
      onClick={() => onOpen(kind)}
    >
      {label}
      {count > 0 && <span className="dock-count">{count}</span>}
    </button>
  )

  return (
    <nav className="mobile-dock" aria-label="Document tools">
      {item('suggestions', 'Suggestions', suggestionCount)}
      {item('comments', 'Comments', commentCount)}
      {item('activity', 'Activity', 0)}
    </nav>
  )
}

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Bottom sheet: backdrop tap, ✕, and Esc close it; the page beneath stays
 *  put (body scroll locks while open). Internal scroll lives in .sheet-body. */
export function MobileSheet({ title, onClose, children }: SheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden />
        <header className="sheet-header">
          <h2>{title}</h2>
          <button className="sheet-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

interface SuggestionSheetProps {
  suggestions: SuggestionPayload[]
  focusId: number | null
  onAccept: (suggestion: SuggestionPayload) => void
  onReject: (suggestion: SuggestionPayload) => void
  /** Present only when several server-backed suggestions are pending. */
  onAcceptAll?: () => Promise<void>
  acceptingAll?: boolean
}

/** The suggestion review surface on mobile — full cards in a scrollable
 *  sheet; opening from a marker scrolls that suggestion into view. */
export function SuggestionSheetList({
  suggestions,
  focusId,
  onAccept,
  onReject,
  onAcceptAll,
  acceptingAll = false,
}: SuggestionSheetProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const [resolving, setResolving] = useState<Set<number>>(new Set())

  // Forget resolving flags for suggestions that left the props.
  useEffect(() => {
    setResolving((prev) => {
      const ids = new Set(suggestions.map((s) => s.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [suggestions])

  useEffect(() => {
    if (focusId === null) return
    listRef.current
      ?.querySelector(`[data-suggestion-id="${focusId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusId])

  const resolve = (suggestion: SuggestionPayload, action: (s: SuggestionPayload) => void) => {
    // Guard repeat taps — a second accept would insert the text twice.
    if (resolving.has(suggestion.id)) return
    setResolving((prev) => new Set(prev).add(suggestion.id))
    action(suggestion)
  }

  if (suggestions.length === 0) {
    return (
      <p className="rail-empty">
        No pending suggestions. Agent proposals land here for review.
      </p>
    )
  }

  return (
    <>
      {onAcceptAll && (
        <button
          className="accept-all-button accept-all-button--sheet"
          disabled={acceptingAll}
          onClick={() => void onAcceptAll()}
        >
          {acceptingAll ? 'Accepting…' : `Accept all ${suggestions.filter((s) => s.id > 0).length}`}
        </button>
      )}
      <ul className="sheet-suggestions" ref={listRef}>
      {suggestions.map((suggestion) => {
        const machine = suggestion.author_kind !== 'human'
        return (
          <li
            key={suggestion.id}
            data-suggestion-id={suggestion.id}
            className={`sheet-card ${focusId === suggestion.id ? 'is-focused' : ''}`}
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
              <del className="margin-old">{truncate(suggestion.replaces, 160)}</del>
            )}
            <p className="margin-new">{truncate(suggestion.body, 400)}</p>
            <div className="suggestion-actions">
              <button
                className="btn-accept"
                disabled={resolving.has(suggestion.id)}
                onClick={() => resolve(suggestion, onAccept)}
              >
                Accept
              </button>
              <button
                className="btn-reject"
                disabled={resolving.has(suggestion.id)}
                onClick={() => resolve(suggestion, onReject)}
              >
                Reject
              </button>
            </div>
          </li>
        )
      })}
      </ul>
    </>
  )
}
