export function UnsavedEditNotice({ unsaved }: { unsaved: boolean }) {
  if (!unsaved) return null
  return (
    <div className="doc-notice" role="alert">
      <span>
        The latest changes in this tab are not saved because one edit is too large. Anything you
        change after it is not saved either, even if you undo it. Copy what you need before you
        reload or leave this page.
      </span>
    </div>
  )
}
