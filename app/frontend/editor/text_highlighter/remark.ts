import { $remark } from '@milkdown/kit/utils'
import { isHighlightColorId } from './palette'

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  [key: string]: unknown
}

const OPEN_SPAN = /^<span\s+data-highlighter(?:="")?\s*(?:data-color="([^"]*)")?\s*>$/
const CLOSE_SPAN = /^<\/span>$/

/**
 * Serialization: emit highlighter mdast nodes as HTML spans, mirroring the
 * provenance transformers. Markdown stays legal everywhere; the spans
 * round-trip back to marks via the transformer below.
 */
export const highlighterStringify = $remark('highlighterStringify', () =>
  function (this: { data: (key?: string) => unknown }) {
    const data = this.data() as Record<string, unknown[]>
    const extension = {
      handlers: {
        highlighter: (
          node: MdastNode,
          _parent: unknown,
          state: {
            containerPhrasing: (n: MdastNode, i: unknown) => string
          },
          info: unknown,
        ) => {
          const inner = state.containerPhrasing(node, info)
          // Palette ids are [a-z]+ so no attribute escaping is needed, but
          // guard anyway: an unknown color serializes as a plain span the
          // parser below will ignore.
          const color = String(node.color ?? '').replace(/[^a-z]/g, '')
          return `<span data-highlighter data-color="${color}">${inner}</span>`
        },
      },
    }
    data.toMarkdownExtensions ??= []
    data.toMarkdownExtensions.push(extension)
  },
)

/**
 * Parsing: micromark turns inline HTML into opaque `html` nodes. Find
 * <span data-highlighter ...> ... </span> runs inside phrasing content and
 * replace them with a `highlighter` mdast node so the mark schema's
 * parseMarkdown picks them up. Flat spans only (no nesting), and unknown
 * colors are left as raw HTML for the sanitizer to handle.
 */
export const highlighterParse = $remark('highlighterParse', () => () => (root: unknown) => {
  const tree = root as MdastNode
  const visit = (node: MdastNode): void => {
    const children = node.children
    if (!children) return
    children.forEach(visit)

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]
      if (child.type !== 'html' || typeof child.value !== 'string') continue
      const open = OPEN_SPAN.exec(child.value.trim())
      if (!open) continue
      const color = open[1] ?? ''
      if (!isHighlightColorId(color)) continue

      const closeIndex = children.findIndex(
        (sibling, j) =>
          j > i &&
          sibling.type === 'html' &&
          typeof sibling.value === 'string' &&
          CLOSE_SPAN.test(sibling.value.trim()),
      )
      if (closeIndex === -1) continue

      const inner = children.slice(i + 1, closeIndex)
      const highlighterNode: MdastNode = {
        type: 'highlighter',
        color,
        children: inner,
      }
      children.splice(i, closeIndex - i + 1, highlighterNode)
    }
  }
  visit(tree)
})
