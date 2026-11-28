export function UnsavedEditNotice({ unsaved }: { unsaved: boolean }) {
  if (!unsaved) return null
  return (
    <div className="doc-notice doc-notice--pinned" role="alert">
      <span>
        This tab holds a change that is too large to save. That change and any later changes to
        the text can be lost, even if you undo it. Copy what you need before you reload or leave
        this page.
      </span>
    </div>
  )
}
