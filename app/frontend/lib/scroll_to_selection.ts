import type { Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/** Dispatch a transaction and bring its selection into view. ProseMirror skips
 *  that scroll while the browser's selection is outside the editor (before the
 *  first click in it, or after a click on a card), so the page scrolls then. */
export function dispatchIntoView(view: EditorView, tr: Transaction): void {
  const focusNode = document.getSelection()?.focusNode ?? null
  const editorScrolls = view.dom.contains(focusNode)
  view.dispatch(tr.scrollIntoView())
  if (editorScrolls) return
  const { top, bottom } = view.coordsAtPos(view.state.selection.head)
  if (top >= 0 && bottom <= window.innerHeight) return
  window.scrollBy({ top: top - window.innerHeight * 0.4, behavior: 'instant' })
}
