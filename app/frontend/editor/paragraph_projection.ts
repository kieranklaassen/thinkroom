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

const SKIPPED_BLOCKS = new Set(['code_block', 'table'])

// ProseMirror documents are immutable: one projection per version.
const projections = new WeakMap<Node, ProjectedParagraph[]>()

/**
 * The document's textblocks (paragraphs, headings, list items, quotes) with
 * their text-node text. Code blocks and tables are skipped: reviewers judge
 * prose. Inline leaves (hard breaks, images) contribute a newline so words on
 * either side never merge; the server treats "\n" as a phrase boundary and
 * an anchored span never crosses one (paragraphRange needs text nodes at
 * both ends). The same projection anchors findings back, so a stored offset
 * means the same characters on both sides (see use_finding_anchors.ts).
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
      if (!child.isText) {
        chunks.push('\n')
        length += 1
        return
      }
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

/**
 * ProseMirror range for [offset, offset + length) inside a projected block,
 * or null when the span holds no text. A span may start or end on a projected
 * leaf (the `\n` of a hard break or image): the range snaps inward to the
 * first and last text characters it covers, since a leaf has no text to paint.
 */
export function paragraphRange(
  paragraph: ProjectedParagraph,
  offset: number,
  length: number,
): { from: number; to: number } | null {
  const end = offset + length
  if (offset < 0 || end > paragraph.text.length || length <= 0) return null
  const first = paragraph.segments.find((segment) => offset < segment.end)
  const last = [...paragraph.segments].reverse().find((segment) => end > segment.start)
  if (!first || !last) return null
  const from = first.pos + Math.max(offset, first.start) - first.start
  const to = last.pos + Math.min(end, last.end) - last.start
  return from < to ? { from, to } : null
}

/** The projected characters a stored quote must still match. The projection
 *  is what the server judged, so comparing against it (not against
 *  `textBetween`, which skips inline leaves) keeps both sides identical. */
export function paragraphSlice(paragraph: ProjectedParagraph, offset: number, length: number): string {
  return paragraph.text.slice(offset, offset + length)
}

/** Server offsets count codepoints (Ruby String#index); JavaScript strings
 *  count UTF-16 units. Convert so an emoji before a quote does not shift it. */
export function codepointOffsetToIndex(text: string, codepoints: number): number {
  let index = 0
  let seen = 0
  while (seen < codepoints && index < text.length) {
    const code = text.codePointAt(index) ?? 0
    index += code > 0xffff ? 2 : 1
    seen += 1
  }
  return index
}

/**
 * FNV-1a 32-bit over the codepoints of every paragraph with a unit separator
 * between them: the same fingerprint CompoundWriting::ParagraphDigest computes
 * for a pass, so the panel can say the text changed since the last run.
 */
export function paragraphDigest(texts: string[]): string {
  let hash = 0x811c9dc5
  const mix = (value: number) => {
    hash = Math.imul(hash ^ value, 0x01000193) >>> 0
  }
  texts.forEach((text, index) => {
    if (index > 0) mix(0x1f)
    for (const character of text) mix(character.codePointAt(0) ?? 0)
  })
  return hash.toString(16).padStart(8, '0')
}
