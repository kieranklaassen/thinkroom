import { $remark } from '@milkdown/kit/utils'

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  [key: string]: unknown
}

const OPEN_SPAN =
  /^<span\s+data-provenance(?:="")?\s*(?:data-kind="([^"]*)")?\s*(?:data-author="([^"]*)")?\s*(?:data-state="([^"]*)")?\s*>$/
const CLOSE_SPAN = /^<\/span>$/

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Serialization: emit provenance mdast nodes as HTML spans. Markdown stays
 * legal everywhere; the spans round-trip back to marks via the transformer
 * below. Without this handler remark-stringify throws on the unknown node.
 */
export const provenanceStringify = $remark('provenanceStringify', () =>
  function (this: { data: (key?: string) => unknown }) {
    const data = this.data() as Record<string, unknown[]>
    const extension = {
      handlers: {
        provenance: (
          node: MdastNode,
          _parent: unknown,
          state: {
            containerPhrasing: (n: MdastNode, i: unknown) => string
          },
          info: unknown,
        ) => {
          const inner = state.containerPhrasing(node, info)
          const kind = escapeAttr((node.kind as string) ?? 'human')
          const author = escapeAttr((node.author as string) ?? '')
          const reviewState = escapeAttr((node.state as string) ?? 'verbatim')
          return `<span data-provenance data-kind="${kind}" data-author="${author}" data-state="${reviewState}">${inner}</span>`
        },
      },
    }
    data.toMarkdownExtensions ??= []
    data.toMarkdownExtensions.push(extension)
  },
)

/**
 * Parsing: micromark turns inline HTML into opaque `html` nodes. This
 * transformer finds <span data-provenance ...> ... </span> runs inside
 * phrasing content and replaces them with a `provenance` mdast node so the
 * mark schema's parseMarkdown picks them up. Flat spans only (no nesting).
 */
export const provenanceParse = $remark('provenanceParse', () => () => (root: unknown) => {
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

      const closeIndex = children.findIndex(
        (sibling, j) =>
          j > i &&
          sibling.type === 'html' &&
          typeof sibling.value === 'string' &&
          CLOSE_SPAN.test(sibling.value.trim()),
      )
      if (closeIndex === -1) continue

      const inner = children.slice(i + 1, closeIndex)
      const provenanceNode: MdastNode = {
        type: 'provenance',
        kind: open[1] ?? 'human',
        author: open[2] ?? '',
        state: open[3] ?? 'verbatim',
        children: inner,
      }
      children.splice(i, closeIndex - i + 1, provenanceNode)
    }
  }
  visit(tree)
})

