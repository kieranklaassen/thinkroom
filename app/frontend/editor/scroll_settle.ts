import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
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
const scrollSettleKey = new PluginKey('SCROLL_SETTLE')
const MAX_SETTLE_PASSES = 3

const headTop = (view: EditorView): number | null => {
  try {
    return view.coordsAtPos(view.state.selection.head).top
  } catch {
    return null
  }
}

const settleAfterScroll = (view: EditorView) => {
  requestAnimationFrame(() => {
    const head = view.state.selection.head
    const target = headTop(view)
    if (target === null) return
    let passes = 0
    const settle = () => {
      if (view.isDestroyed || view.state.selection.head !== head) return
      const top = headTop(view)
      if (top === null) return
      const drift = top - target
      if (Math.abs(drift) <= 1) return
      window.scrollBy({ top: drift, behavior: 'instant' })
      passes += 1
      if (passes < MAX_SETTLE_PASSES) requestAnimationFrame(settle)
    }
    requestAnimationFrame(settle)
  })
}

// A block already on screen is rendered, so scrolling to it shifts nothing;
// only jumps into unrendered territory need the settle passes. The block's
// own box is laid out even while its contents are skipped, so this read does
// not force the contents to render.
const headBlockOnScreen = (view: EditorView): boolean => {
  try {
    const { node } = view.domAtPos(view.state.selection.head)
    const element = node instanceof Element ? node : node.parentElement
    const block = element?.closest('.ProseMirror > *')
    if (!block) return true
    // Blocks within a screen of the viewport are already rendered, so only a
    // farther jump can land on placeholders.
    const rect = block.getBoundingClientRect()
    return rect.bottom > -window.innerHeight && rect.top < window.innerHeight * 2
  } catch {
    // A position the DOM cannot resolve yet (mid-redraw) is not a jump; the
    // transaction must go through untouched.
    return true
  }
}

const scrollSettleProse = $prose(
  () =>
    new Plugin({
      key: scrollSettleKey,
      props: {
        handleScrollToSelection(view) {
          if (!headBlockOnScreen(view)) settleAfterScroll(view)
          return false
        },
      },
    }),
)

export const scrollSettle = [scrollSettleProse].flat()
