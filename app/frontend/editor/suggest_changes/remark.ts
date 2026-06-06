import { $remark } from '@milkdown/kit/utils'

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  [key: string]: unknown
}

const OPEN_INS =
  /^<ins\s+data-suggestion-id="([^"]*)"\s*(?:data-author="([^"]*)")?\s*>$/
const CLOSE_INS = /^<\/ins>$/
const OPEN_DEL =
  /^<del\s+data-suggestion-id="([^"]*)"\s*(?:data-author="([^"]*)")?\s*>$/
const CLOSE_DEL = /^<\/del>$/

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

interface PhrasingState {
  containerPhrasing: (n: MdastNode, i: unknown) => string
}

/**
 * Serialization: pending suggestion marks become <ins>/<del> inline HTML so
 * markdown stays legal on every surface (snapshots, agent API reads) and
 * round-trips back to marks via the parse transformer below. Registered with
 * the marks so no getMarkdown() can fire before the handlers exist — without
 * them remark-stringify throws on the first marked character.
 */
export const suggestStringify = $remark('suggestStringify', () =>
  function (this: { data: (key?: string) => unknown }) {
    const data = this.data() as Record<string, unknown[]>
    const extension = {
      handlers: {
        suggestInsertion: (node: MdastNode, _parent: unknown, state: PhrasingState, info: unknown) => {
          const inner = state.containerPhrasing(node, info)
          const id = escapeAttr((node.suggestionId as string) ?? '')
          const author = escapeAttr((node.author as string) ?? '')
          return `<ins data-suggestion-id="${id}" data-author="${author}">${inner}</ins>`
        },
        suggestDeletion: (node: MdastNode, _parent: unknown, state: PhrasingState, info: unknown) => {
          const inner = state.containerPhrasing(node, info)
          const id = escapeAttr((node.suggestionId as string) ?? '')
          const author = escapeAttr((node.author as string) ?? '')
          return `<del data-suggestion-id="${id}" data-author="${author}">${inner}</del>`
        },
        // Formatting-change marker: content only, no wrapper (v1 pass-through).
        suggestModification: (node: MdastNode, _parent: unknown, state: PhrasingState, info: unknown) =>
          state.containerPhrasing(node, info),
      },
    }
    data.toMarkdownExtensions ??= []
    data.toMarkdownExtensions.push(extension)
  },
)

/**
 * Parsing: micromark renders inline HTML as opaque `html` nodes. Replace
 * <ins data-suggestion-id> / <del data-suggestion-id> runs with mdast nodes
 * the mark schemas' parseMarkdown picks up. Flat spans only (no nesting),
 * mirroring the provenance transformer.
 */
export const suggestParse = $remark('suggestParse', () => () => (root: unknown) => {
  const tree = root as MdastNode
  const patterns: { open: RegExp; close: RegExp; type: string }[] = [
    { open: OPEN_INS, close: CLOSE_INS, type: 'suggestInsertion' },
    { open: OPEN_DEL, close: CLOSE_DEL, type: 'suggestDeletion' },
  ]

  const visit = (node: MdastNode): void => {
    const children = node.children
    if (!children) return
    children.forEach(visit)

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]
      if (child.type !== 'html' || typeof child.value !== 'string') continue

      for (const { open, close, type } of patterns) {
        const match = open.exec(child.value.trim())
        if (!match) continue

        const closeIndex = children.findIndex(
          (sibling, j) =>
            j > i &&
            sibling.type === 'html' &&
            typeof sibling.value === 'string' &&
            close.test(sibling.value.trim()),
        )
        if (closeIndex === -1) continue

        const inner = children.slice(i + 1, closeIndex)
        const suggestionNode: MdastNode = {
          type,
          suggestionId: match[1] ?? '',
          author: match[2] ?? '',
          children: inner,
        }
        children.splice(i, closeIndex - i + 1, suggestionNode)
        break
      }
    }
  }
  visit(tree)
})
