/** Shared mdast helpers for the inline-HTML span transformers (provenance,
 *  text highlighter). Micromark splits inline HTML into separate open/close
 *  nodes, so pairing must be nesting-aware: marks serialize nested (e.g. a
 *  highlighter span inside a provenance span), and pairing an open tag with
 *  the first `</span>` in sight would adopt the inner span's close, corrupt
 *  the tree, and leave stray raw HTML in the document. */

export interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  [key: string]: unknown
}

const OPENS_SPAN = /^<span[\s>]/
export const CLOSE_SPAN = /^<\/span>$/

/** Index of the `</span>` html node closing the span opened at `openIndex`,
 *  skipping over nested span pairs; -1 when unclosed. */
export function findSpanClose(children: MdastNode[], openIndex: number): number {
  let depth = 0
  for (let index = openIndex + 1; index < children.length; index += 1) {
    const sibling = children[index]
    if (sibling.type !== 'html' || typeof sibling.value !== 'string') continue
    const value = sibling.value.trim()
    if (OPENS_SPAN.test(value)) {
      depth += 1
    } else if (CLOSE_SPAN.test(value)) {
      if (depth === 0) return index
      depth -= 1
    }
  }
  return -1
}
