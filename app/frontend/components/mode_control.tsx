import { useRef, useState } from 'react'
import { useDismissable } from '../lib/use_dismissable'

export type EditorMode = 'edit' | 'suggest' | 'comment' | 'read'

export const MODE_LABELS: Record<EditorMode, string> = {
  edit: 'Edit',
  suggest: 'Suggest',
  comment: 'Comment',
  read: 'Read',
}

const MODE_HINTS: Record<EditorMode, string> = {
  edit: 'Type directly into the document',
  suggest: 'Type directly — edits appear as tracked suggestions for review',
  comment: 'Read-only — click or select text to comment',
  read: 'Clean reading view — links and checkboxes stay interactive',
}

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
  useDismissable(open, () => setOpen(false), [rootRef])

  return (
    <div className="share-root mode-control" ref={rootRef}>
      <button
        className="chrome-toggle mode-control-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Mode: ${MODE_LABELS[mode]}`}
        title={locked ? lockedReason ?? 'Mode switching is disabled on the demo doc' : MODE_HINTS[mode]}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
      >
        {MODE_LABELS[mode]}
        <span className="mode-control-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="share-popover mode-control-popover" role="listbox" aria-label="Editor mode">
          {(Object.keys(MODE_LABELS) as EditorMode[]).map((value) => (
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
              <span className="mode-control-option-label">{MODE_LABELS[value]}</span>
              <span className="mode-control-option-hint">{MODE_HINTS[value]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
