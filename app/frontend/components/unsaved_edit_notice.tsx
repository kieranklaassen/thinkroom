import type { SaveState } from '../editor/cable_provider'

/** Says a large edit is not saved, for as long as it is not. */
export function UnsavedEditNotice({ saveState }: { saveState: SaveState }) {
  if (saveState !== 'stuck') return null
  return (
    <div className="doc-notice" role="alert">
      <span>
        Your latest changes are not saved: one is too large, was refused, or could not be sent.
        Copy what you need before you reload or leave this page.
      </span>
    </div>
  )
}
