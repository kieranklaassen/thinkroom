import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * Offscreen top-level blocks are unrendered placeholders (content-visibility in
 * styles/editor.css) until they enter the viewport. A scroll that jumps far
 * therefore lands near its target and the blocks that then render around it
 * shift the target. ProseMirror still performs its own scrollIntoView; this
 * then holds the selection head where it landed for the next frames while the
 * neighbourhood renders. Stops as soon as a frame shows no drift, so an
 * in-viewport edit costs one geometry read.
 */
const scrollSettleKey = new PluginKey<number>('SCROLL_SETTLE')
// By name: the collab plugin can hold its own key object (collab_positions.ts).
const Y_SYNC_META = 'y-sync$'
const MAX_SETTLE_PASSES = 3

const headTop = (view: EditorView): number | null => {
  try {
    return view.coordsAtPos(view.state.selection.head).top
  } catch {
    return null
  }
}

// Whether a transaction puts the selection on other text, rather than the
// document changing around it. A remote edit replaces the whole body, so its
// mapping says nothing: y-sync sets the selection back on the same text itself.
// Where that text is gone it sets none, or a cursor on a neighbour.
const movesSelection = (tr: Transaction, before: EditorState, after: EditorState): boolean => {
  if (tr.docChanged && tr.getMeta(Y_SYNC_META)) {
    return !tr.selectionSet || (after.selection.empty && !before.selection.empty)
  }
  const { pos, deletedBefore } = tr.mapping.mapResult(before.selection.head)
  return deletedBefore || after.selection.head !== pos
}

/** A check for whether the selection has moved to other text since this call. */
export const selectionMoves = (view: EditorView): (() => boolean) => {
  const moves = scrollSettleKey.getState(view.state)
  return () => scrollSettleKey.getState(view.state) !== moves
}

const headChanges = (view: EditorView): (() => boolean) => {
  const { head } = view.state.selection
  return () => view.isDestroyed || view.state.selection.head !== head
}

/** Keep the selection head where it is now while the next frames render, unless
 *  `isOver` says the scroll that put it there no longer stands. */
export const holdHead = (view: EditorView, isOver = headChanges(view)) => {
  const target = headTop(view)
  if (target === null) return
  let passes = 0
  const settle = () => {
    if (isOver()) return
    const top = headTop(view)
    if (top === null) return
    const drift = top - target
    if (Math.abs(drift) <= 1) return
    window.scrollBy({ top: drift, behavior: 'instant' })
    passes += 1
    if (passes < MAX_SETTLE_PASSES) requestAnimationFrame(settle)
  }
  requestAnimationFrame(settle)
}

// ProseMirror scrolls after handleScrollToSelection returns.
const settleAfterScroll = (view: EditorView) => {
  requestAnimationFrame(() => holdHead(view))
}

export const headElement = (view: EditorView): Element | null => {
  try {
    const { node } = view.domAtPos(view.state.selection.head)
    return node instanceof Element ? node : node.parentElement
  } catch {
    // A position the DOM cannot resolve yet (mid-redraw).
    return null
  }
}

/** The top-level block holding the selection head. Its own box is laid out even
 *  while its contents are skipped, so reading it does not force them to render. */
export const headBlock = (view: EditorView): Element | null =>
  headElement(view)?.closest('.ProseMirror > *') ?? null

// A block already on screen is rendered, so scrolling to it shifts nothing;
// only jumps into unrendered territory need the settle passes.
export const blockOnScreen = (block: Element): boolean => {
  // Only a block crossing the viewport is certainly rendered. A block
  // outside it may still be a placeholder, and this box is the placeholder
  // geometry, so anything beyond the edge counts as a jump.
  const rect = block.getBoundingClientRect()
  return rect.bottom > 0 && rect.top < window.innerHeight
}

export const scrollSettlePlugin = () =>
  new Plugin<number>({
    key: scrollSettleKey,
    // How often the selection has moved to other text.
    state: {
      init: () => 0,
      apply: (tr, moves, before, after) => (movesSelection(tr, before, after) ? moves + 1 : moves),
    },
    props: {
      handleScrollToSelection(view) {
        const block = headBlock(view)
        if (block && !blockOnScreen(block)) settleAfterScroll(view)
        return false
      },
    },
  })

export const scrollSettle = [$prose(scrollSettlePlugin)].flat()
