import { Fragment, type RefObject } from 'react'

interface Action {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

interface Swatch {
  id: string
  /** Accessible name — the user-given legend name when one exists. */
  label: string
  /** Saturated swatch color for the button dot. */
  color: string
  /** The whole selection already carries this color (click removes it). */
  active: boolean
  onClick: () => void
}

interface Props {
  /** Placement ref from useAnchoredPopover — measured for real-width clamping. */
  rootRef: RefObject<HTMLDivElement | null>
  /** Measured position; null during the pre-measure hidden phase. */
  position: { x: number; y: number } | null
  /** Action list for the current selection. */
  actions: Action[]
  /** Highlighter palette dots; renders after the text actions. */
  swatches?: Swatch[]
}

/** Floating actions over a non-empty text selection. */
export function SelectionToolbar({ rootRef, position, actions, swatches = [] }: Props) {
  if (actions.length === 0 && swatches.length === 0) return null
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
      {swatches.length > 0 && (
        <>
          {actions.length > 0 && <span className="selection-toolbar-sep" />}
          <span className="selection-toolbar-swatches">
            {swatches.map((swatch) => (
              <button
                key={swatch.id}
                className={`selection-swatch ${swatch.active ? 'is-active' : ''}`}
                style={{ background: swatch.color }}
                onClick={swatch.onClick}
                title={swatch.active ? `Remove ${swatch.label} highlight` : swatch.label}
                aria-label={swatch.active ? `Remove ${swatch.label} highlight` : swatch.label}
                aria-pressed={swatch.active}
              />
            ))}
          </span>
        </>
      )}
    </div>
  )
}
