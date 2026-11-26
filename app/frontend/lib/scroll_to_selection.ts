import type { Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { blockOnScreen, headBlock, holdHead } from '../editor/scroll_settle'

// Where a jump puts its text, as a share of the window height.
const JUMP_LINE = 0.4

/** Dispatch a transaction and bring its selection into view. ProseMirror skips
 *  that scroll while the browser's selection is outside the editor (before the
 *  first click in it, or after a click on a card), so the page scrolls then. */
export function dispatchIntoView(view: EditorView, tr: Transaction): void {
  const focusNode = document.getSelection()?.focusNode ?? null
  const editorScrolls = view.dom.contains(focusNode)
  view.dispatch(tr.scrollIntoView())
  if (editorScrolls) return

  const block = headBlock(view)
  if (block && !blockOnScreen(block)) {
    // Text in a block a long document has not rendered has no reliable
    // coordinates (WebKit can report 0/0), so bring the block on screen first.
    // Browsers render it after the next frame's callbacks, hence two frames.
    scrollToJumpLine(block.getBoundingClientRect().top)
    requestAnimationFrame(() => requestAnimationFrame(() => placeHead(view)))
    return
  }
  const { top, bottom } = view.coordsAtPos(view.state.selection.head)
  if (top >= chromeTop() && bottom <= chromeBottom()) return
  placeHead(view)
}

function placeHead(view: EditorView): void {
  if (view.isDestroyed) return
  scrollToJumpLine(view.coordsAtPos(view.state.selection.head).top)
  holdHead(view)
}

function scrollToJumpLine(top: number): void {
  window.scrollBy({ top: top - window.innerHeight * JUMP_LINE, behavior: 'instant' })
}

// The sticky header and the mobile dock cover text. Either can be absent or
// hidden, and then measures zero.
function chromeTop(): number {
  return Math.max(0, document.querySelector('.doc-header')?.getBoundingClientRect().bottom ?? 0)
}

function chromeBottom(): number {
  const dock = document.querySelector('.mobile-dock')?.getBoundingClientRect()
  return dock?.height ? dock.top : window.innerHeight
}
