import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { isHighlightColorId, type HighlightColorId } from './palette'

/**
 * The selection's uniform highlight color: the color when every text node in
 * the selection carries the highlighter mark with the same color, else null.
 * Drives the toggle affordance — clicking the active swatch removes it.
 */
export function selectionHighlightColor(state: EditorState): HighlightColorId | null {
  const { from, to, empty } = state.selection
  if (empty) return null
  const markType = state.schema.marks.highlighter
  if (!markType) return null

  let color: HighlightColorId | null | undefined
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText || color === null) return
    const mark = markType.isInSet(node.marks)
    const nodeColor =
      mark && isHighlightColorId(mark.attrs.color as string)
        ? (mark.attrs.color as HighlightColorId)
        : null
    if (color === undefined) color = nodeColor
    else if (color !== nodeColor) color = null
  })
  return color ?? null
}

/** Highlight the selection; an existing color is replaced (same-type marks
 *  never stack in ProseMirror). */
export function applyHighlight(view: EditorView, color: HighlightColorId): void {
  const { from, to, empty } = view.state.selection
  const markType = view.state.schema.marks.highlighter
  if (empty || !markType) return
  view.dispatch(view.state.tr.addMark(from, to, markType.create({ color })))
}

export function removeHighlight(view: EditorView): void {
  const { from, to, empty } = view.state.selection
  const markType = view.state.schema.marks.highlighter
  if (empty || !markType) return
  view.dispatch(view.state.tr.removeMark(from, to, markType))
}
