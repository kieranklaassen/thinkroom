interface Props {
  position: { x: number; y: number }
  onComment: () => void
  onAskAi: () => void
}

/** Floating actions over a non-empty text selection. */
export function SelectionToolbar({ position, onComment, onAskAi }: Props) {
  return (
    <div
      className="selection-toolbar"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.preventDefault()}
      role="toolbar"
      aria-label="Selection actions"
    >
      <button onClick={onComment}>Comment</button>
      <span className="selection-toolbar-sep" />
      <button onClick={onAskAi}>Ask AI</button>
    </div>
  )
}
