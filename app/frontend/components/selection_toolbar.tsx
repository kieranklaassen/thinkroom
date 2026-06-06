import { Fragment } from 'react'

interface Action {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

interface Props {
  position: { x: number; y: number }
  /** Mode-gated action list (Edit: Comment · Ask AI; Suggest: Suggest a
   *  change; Comment: Comment). Renders nothing when empty. */
  actions: Action[]
}

/** Floating actions over a non-empty text selection. */
export function SelectionToolbar({ position, actions }: Props) {
  if (actions.length === 0) return null
  return (
    <div
      className="selection-toolbar"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.preventDefault()}
      role="toolbar"
      aria-label="Selection actions"
    >
      {actions.map((action, i) => (
        <Fragment key={action.label}>
          {i > 0 && <span className="selection-toolbar-sep" />}
          <button onClick={action.onClick} disabled={action.disabled} title={action.title}>
            {action.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
