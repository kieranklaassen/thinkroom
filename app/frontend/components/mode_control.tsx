import { useRef, useState } from 'react'
import { useDismissable } from '../lib/use_dismissable'

export type EditorMode = 'edit' | 'suggest' | 'comment'

export const MODE_LABELS: Record<EditorMode, string> = {
  edit: 'Edit',
  suggest: 'Suggest',
  comment: 'Comment',
}

const MODE_HINTS: Record<EditorMode, string> = {
  edit: 'Type directly into the document',
  suggest: 'Propose changes for review — nothing edits the doc directly',
  comment: 'Read-only — select text to comment',
}

interface Props {
  mode: EditorMode
  onChange: (mode: EditorMode) => void
  /** Demo doc: control renders but stays locked to Edit. */
  locked?: boolean
}

/**
 * Google-Docs-style mode switcher: a compact header dropdown showing the
 * current mode, opening to the three modes with hints. Per-visitor UI state
 * only — switching never affects other collaborators.
 */
export function ModeControl({ mode, onChange, locked = false }: Props) {
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
        title={locked ? 'Mode switching is disabled on the demo doc' : MODE_HINTS[mode]}
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
