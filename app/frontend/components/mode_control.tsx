import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDismissable } from '../lib/use_dismissable'
import { useMediaQuery } from '../lib/use_media_query'

export type EditorMode = 'edit' | 'suggest' | 'comment' | 'read'

const MODE_OPTIONS: ReadonlyArray<{
  value: EditorMode
  label: string
  hint: string
  shortcut: number
}> = [
  { value: 'edit', label: 'Edit', hint: 'Type directly into the document', shortcut: 1 },
  {
    value: 'suggest',
    label: 'Suggest',
    hint: 'Type directly — edits appear as tracked suggestions for review',
    shortcut: 2,
  },
  {
    value: 'comment',
    label: 'Comment',
    hint: 'Read-only — click or select text to comment',
    shortcut: 3,
  },
  {
    value: 'read',
    label: 'Read',
    hint: 'Clean reading view — links and checkboxes stay interactive',
    shortcut: 4,
  },
]

export const MODE_SHORTCUTS = Object.fromEntries(
  MODE_OPTIONS.map(({ shortcut, value }) => [`Digit${shortcut}`, value]),
) as Record<string, EditorMode>

interface Props {
  mode: EditorMode
  onChange: (mode: EditorMode) => void
  /** Demo doc: control renders but stays locked to Edit. */
  locked?: boolean
  lockedReason?: string
}

/**
 * Google-Docs-style mode switcher: a compact header dropdown showing the
 * current mode, opening to the four modes with hints. Per-visitor UI state
 * only — switching never affects other collaborators.
 */
export function ModeControl({ mode, onChange, locked = false, lockedReason }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const isMobile = useMediaQuery('(max-width: 48rem)')
  useDismissable(open, () => setOpen(false), [rootRef, popoverRef])
  const activeMode = MODE_OPTIONS.find(({ value }) => value === mode)!

  const popover = (
    <div
      className="share-popover mode-control-popover"
      ref={popoverRef}
      role="listbox"
      aria-label="Editor mode"
      onClick={(event) => event.stopPropagation()}
    >
      {MODE_OPTIONS.map(({ value, label, hint, shortcut }) => (
        <button
          key={value}
          role="option"
          aria-selected={mode === value}
          className={`mode-control-option ${mode === value ? 'is-active' : ''}`}
          onClick={() => {
            onChange(value)
            setOpen(false)
          }}
        >
          <span className="mode-control-option-check" aria-hidden="true">
            {mode === value ? '✓' : ''}
          </span>
          <span className="mode-control-option-copy">
            <span className="mode-control-option-label">{label}</span>
            <span className="mode-control-option-hint">{hint}</span>
          </span>
          <kbd className="mode-control-shortcut" aria-label={`Command or Control ${shortcut}`}>
            ⌘{shortcut}
          </kbd>
        </button>
      ))}
    </div>
  )

  return (
    <div className="share-root mode-control" ref={rootRef}>
      <button
        className="chrome-toggle mode-control-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Mode: ${activeMode.label}`}
        title={locked ? lockedReason ?? 'Mode switching is disabled on the demo doc' : activeMode.hint}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`mode-control-dot mode-control-dot--${mode}`} aria-hidden="true" />
        {activeMode.label} mode
        <span className="mode-control-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open &&
        (isMobile
          ? createPortal(
              <div className="share-backdrop" onClick={() => setOpen(false)}>
                {popover}
              </div>,
              document.body,
            )
          : popover)}
    </div>
  )
}
