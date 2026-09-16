import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

/**
 * Offscreen top-level blocks use `content-visibility: auto` (styles/editor.css)
 * so a long document only pays for what is on screen. That also paint-contains
 * every such block, and a collaborator cursor label sits above its line, so it
 * would be clipped at the block's edge. This marks the blocks currently holding
 * a cursor widget (human awareness cursors, read pointers, agent cursors) so the
 * stylesheet leaves them out of containment. Widgets come and go with
 * decoration redraws, so the editor root's mutation records are the one place
 * that sees all of them; the marks are refreshed before the next paint.
 */
const CURSOR_SELECTOR = '.ProseMirror-yjs-cursor, .agent-cursor'
export const HOLDS_CURSOR_ATTR = 'data-holds-cursor'

const cursorBlocksKey = new PluginKey('CURSOR_BLOCKS')

const touchesCursor = (node: Node): boolean =>
  node instanceof Element && (node.matches(CURSOR_SELECTOR) || node.querySelector(CURSOR_SELECTOR) !== null)

const topLevelBlock = (root: HTMLElement, node: Element): Element | null => {
  let block: Element | null = node
  while (block && block.parentElement !== root) block = block.parentElement
  return block
}

const cursorBlocksProse = $prose(
  () =>
    new Plugin({
      key: cursorBlocksKey,
      view: (view) => {
        let marked = new Set<Element>()

        const sync = () => {
          const next = new Set<Element>()
          view.dom.querySelectorAll(CURSOR_SELECTOR).forEach((cursor) => {
            const block = topLevelBlock(view.dom, cursor)
            if (block) next.add(block)
          })
          marked.forEach((block) => {
            if (!next.has(block)) block.removeAttribute(HOLDS_CURSOR_ATTR)
          })
          next.forEach((block) => block.setAttribute(HOLDS_CURSOR_ATTR, ''))
          marked = next
        }

        const observer = new MutationObserver((records) => {
          const relevant = records.some(
            (record) =>
              Array.from(record.addedNodes).some(touchesCursor) ||
              Array.from(record.removedNodes).some(touchesCursor),
          )
          if (relevant) sync()
        })
        observer.observe(view.dom, { childList: true, subtree: true })
        sync()

        return {
          destroy: () => {
            observer.disconnect()
            marked.forEach((block) => block.removeAttribute(HOLDS_CURSOR_ATTR))
            marked = new Set()
          },
        }
      },
    }),
)

export const cursorBlocks = [cursorBlocksProse].flat()
