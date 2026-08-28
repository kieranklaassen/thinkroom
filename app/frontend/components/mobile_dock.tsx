import { useEffect, useRef, type ReactNode } from 'react'
import {
  SuggestionCardBody,
  useResolveGuard,
  type ReviewableSuggestion,
} from './suggestion_card'

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
  items: ReviewableSuggestion[]
  focusKey: string | null
  /** Present only when several server-backed suggestions are pending. */
  onAcceptAll?: () => Promise<void>
  acceptingAll?: boolean
}

/** The suggestion review surface on mobile — full cards (tracked edits and
 *  server rows) in one scrollable sheet; opening from a marker scrolls that
 *  suggestion into view. */
export function SuggestionSheetList({
  items,
  focusKey,
  onAcceptAll,
  acceptingAll = false,
}: SuggestionSheetProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const { resolving, resolve } = useResolveGuard(items)

  useEffect(() => {
    if (focusKey === null) return
    listRef.current
      ?.querySelector(`[data-suggestion-key="${focusKey}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusKey])

  if (items.length === 0) {
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
          {acceptingAll
            ? 'Accepting…'
            : `Accept all ${items.filter((item) => !item.inline && item.canResolve).length}`}
        </button>
      )}
      <ul className="sheet-suggestions" ref={listRef}>
        {items.map((item) => (
          <li
            key={item.key}
            data-suggestion-key={item.key}
            className={`sheet-card ${item.inline ? 'sheet-card--inline ' : ''}${focusKey === item.key ? 'is-focused' : ''}`}
          >
            <SuggestionCardBody
              item={item}
              oldLimit={160}
              newLimit={400}
              disabled={resolving.has(item.key)}
              onResolve={resolve}
            />
          </li>
        ))}
      </ul>
    </>
  )
}
