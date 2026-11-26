import type { Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { blockOnScreen, headBlock, holdHead } from '../editor/scroll_settle'

// Where a jump puts its text, as a share of the window height.
const JUMP_LINE = 0.4

let lastJump: AbortController | null = null

/** Dispatch a transaction and bring its selection into view. The page scrolls
 *  itself rather than asking ProseMirror, which skips the scroll while the
 *  browser's selection is outside the editor and otherwise aims at blocks a
 *  long document has not rendered, with no room for the sticky header. */
export function dispatchIntoView(view: EditorView, tr: Transaction): void {
  view.dispatch(tr)
  const isOver = personTakesOver(view)

  const block = headBlock(view)
  if (block && !blockOnScreen(block)) {
    // Text in a block a long document has not rendered has no reliable
    // coordinates (WebKit can report 0/0), so bring the block on screen first.
    // Browsers render it after the next frame's callbacks, hence two frames.
    scrollToJumpLine(block.getBoundingClientRect().top)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!isOver()) placeHead(view, isOver)
    }))
    return
  }
  const { top, bottom } = view.coordsAtPos(view.state.selection.head)
  if (top >= chromeTop() && bottom <= chromeBottom()) scrollAcross(view)
  else placeHead(view, isOver)
}

/** A jump is over once the person scrolls, points, types or selects something
 *  else, or another jump starts. Input events are what tell their scrolling
 *  from the browser's own scroll anchoring. */
function personTakesOver(view: EditorView): () => boolean {
  lastJump?.abort()
  const jump = new AbortController()
  lastJump = jump
  for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown']) {
    window.addEventListener(type, () => jump.abort(), { capture: true, passive: true, signal: jump.signal })
  }
  const { head } = view.state.selection
  return () => jump.signal.aborted || view.isDestroyed || view.state.selection.head !== head
}

function placeHead(view: EditorView, isOver: () => boolean): void {
  scrollToJumpLine(view.coordsAtPos(view.state.selection.head).top)
  scrollAcross(view)
  holdHead(view, isOver)
}

// Code scrolls its long lines sideways inside the page.
function scrollAcross(view: EditorView): void {
  const { head } = view.state.selection
  const { node } = view.domAtPos(head)
  const code = (node instanceof Element ? node : node.parentElement)?.closest('pre code')
  if (!code) return
  const { left, right } = code.getBoundingClientRect()
  const x = view.coordsAtPos(head).left
  if (x < left || x > right) code.scrollLeft += x - (left + right) / 2
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
