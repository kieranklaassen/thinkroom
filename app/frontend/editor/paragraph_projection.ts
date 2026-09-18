import type { Node } from '@milkdown/kit/prose/model'

/** A textblock as the compound writing reviewers see it. */
export interface ProjectedParagraph {
  /** Position among projected blocks, in document order. */
  index: number
  kind: 'paragraph' | 'heading'
  /** Text-node content only, so an offset maps back through `segments`. */
  text: string
  /** ProseMirror position of the block node. */
  pos: number
  /** Text nodes: [start, end) in `text` and the ProseMirror position of start. */
  segments: Array<{ start: number; end: number; pos: number }>
}

/** Index signature: Inertia's request payload type wants plain records. */
export interface ParagraphPayload {
  [key: string]: string | number
  index: number
  kind: 'paragraph' | 'heading'
  text: string
}

const SKIPPED_BLOCKS = new Set(['code_block', 'table', 'table_row', 'table_cell', 'table_header'])

// ProseMirror documents are immutable: one projection per version.
const projections = new WeakMap<Node, ProjectedParagraph[]>()

/**
 * The document's textblocks (paragraphs, headings, list items, quotes) with
 * their text-node text. Code blocks and tables are skipped: reviewers judge
 * prose. The same projection anchors findings back, so a stored offset means
 * the same characters on both sides (see use_finding_anchors.ts).
 */
export function projectParagraphs(doc: Node): ProjectedParagraph[] {
  const cached = projections.get(doc)
  if (cached) return cached
  const result: ProjectedParagraph[] = []
  doc.descendants((node, pos) => {
    if (SKIPPED_BLOCKS.has(node.type.name)) return false
    if (!node.isTextblock) return true
    const segments: ProjectedParagraph['segments'] = []
    const chunks: string[] = []
    let length = 0
    node.forEach((child, offset) => {
      if (!child.isText) return
      const text = child.text ?? ''
      segments.push({ start: length, end: length + text.length, pos: pos + 1 + offset })
      chunks.push(text)
      length += text.length
    })
    const text = chunks.join('')
    if (!text.trim()) return false
    result.push({
      index: result.length,
      kind: node.type.name === 'heading' ? 'heading' : 'paragraph',
      text,
      pos,
      segments,
    })
    return false
  })
  projections.set(doc, result)
  return result
}

/** The wire shape for POST writing_passes. */
export function paragraphPayload(paragraphs: ProjectedParagraph[]): ParagraphPayload[] {
  return paragraphs.map(({ index, kind, text }) => ({ index, kind, text }))
}

/** ProseMirror range for [offset, offset + length) inside a projected block,
 *  or null when the span leaves the block's text nodes. */
export function paragraphRange(
  paragraph: ProjectedParagraph,
  offset: number,
  length: number,
): { from: number; to: number } | null {
  const end = offset + length
  if (offset < 0 || end > paragraph.text.length || length <= 0) return null
  const first = paragraph.segments.find((segment) => offset >= segment.start && offset < segment.end)
  const last = paragraph.segments.find((segment) => end > segment.start && end <= segment.end)
  if (!first || !last) return null
  return { from: first.pos + offset - first.start, to: last.pos + end - last.start }
}

/** Words in a projection, for the "too long to review" guard on the client. */
export function projectedWordCount(paragraphs: ProjectedParagraph[]): number {
  return paragraphs.reduce((sum, paragraph) => sum + (paragraph.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0), 0)
}
