import { Fragment, type RefObject } from 'react'

interface Action {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

interface Props {
  /** Placement ref from useAnchoredPopover — measured for real-width clamping. */
  rootRef: RefObject<HTMLDivElement | null>
  /** Measured position; null during the pre-measure hidden phase. */
  position: { x: number; y: number } | null
  /** Mode-gated action list (Edit: Comment · Ask AI; Suggest: Suggest a
   *  change; Comment: Comment). Renders nothing when empty. */
  actions: Action[]
}

/** Floating actions over a non-empty text selection. */
export function SelectionToolbar({ rootRef, position, actions }: Props) {
  if (actions.length === 0) return null
  const placed = position !== null
  return (
    <div
      ref={rootRef}
      className={`selection-toolbar ${placed ? 'is-placed' : ''}`}
      style={position ? { left: position.x, top: position.y } : undefined}
      inert={!placed}
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
