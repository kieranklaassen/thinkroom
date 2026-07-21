import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { HIGHLIGHT_COLORS, isHighlightColorId, type HighlightColorId } from './palette'

export interface HighlightSnippet {
  text: string
  from: number
  to: number
}

export interface HighlightGroup {
  color: HighlightColorId
  snippets: HighlightSnippet[]
}

/**
 * Collect the document's highlights grouped by color in palette order.
 * Adjacent same-color text nodes (a highlight spanning bold text produces
 * several) merge into one snippet; a highlight crossing block boundaries
 * yields one snippet per block, which is the right granularity for the
 * legend's jump targets.
 */
export function collectHighlights(doc: ProseNode): HighlightGroup[] {
  const snippetsByColor = new Map<HighlightColorId, HighlightSnippet[]>()

  doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find((m) => m.type.name === 'highlighter')
    const color = mark?.attrs.color as string | undefined
    if (!color || !isHighlightColorId(color)) return

    const snippets = snippetsByColor.get(color) ?? []
    if (snippets.length === 0) snippetsByColor.set(color, snippets)
    const last = snippets[snippets.length - 1]
    if (last && last.to === pos) {
      last.to = pos + node.nodeSize
      last.text += node.text ?? ''
    } else {
      snippets.push({ text: node.text ?? '', from: pos, to: pos + node.nodeSize })
    }
  })

  return HIGHLIGHT_COLORS.filter((color) => snippetsByColor.has(color.id)).map((color) => ({
    color: color.id,
    snippets: snippetsByColor.get(color.id) as HighlightSnippet[],
  }))
}
