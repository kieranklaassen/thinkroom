import type { Node } from '@milkdown/kit/prose/model'

export interface CommentRange { from: number; to: number }

interface TextSegment { start: number; end: number; pos: number }
// ProseMirror documents are immutable. Share one text projection across all
// comments on this version; old versions can be collected after a transaction.
const projections = new WeakMap<Node, { text: string; segments: TextSegment[] }>()

function projectText(doc: Node) {
  const cached = projections.get(doc)
  if (cached) return cached
  const chunks: string[] = []
  const segments: TextSegment[] = []
  let length = 0
  let firstBlock = true
  doc.descendants((node, pos) => {
    const text = node.isText ? node.text! : node.isLeaf ? node.type.spec.leafText?.(node) ?? '' : ''
    // Match textBetween's block separators, including empty text blocks and
    // leaf text. Only real text nodes can supply a quote's endpoints.
    if (node.isBlock && (node.isTextblock || (node.isLeaf && text))) {
      if (!firstBlock) { chunks.push('\n'); length++ }
      firstBlock = false
    }
    if (node.isText) segments.push({ start: length, end: length + text.length, pos })
    chunks.push(text)
    length += text.length
  })
  const projection = { text: chunks.join(''), segments }
  projections.set(doc, projection)
  return projection
}

/** Stored quotes have no durable identity. Never guess among occurrences,
 * including overlapping matches or duplicated multi-paragraph selections. */
export function findCommentAnchorRange(doc: Node, anchor: string | null): CommentRange | null {
  if (!anchor) return null
  const { text, segments } = projectText(doc)
  const index = text.indexOf(anchor)
  // Search the entire quote, not pairs of matching first/last lines. A tiny
  // unmatched quote must not create a cartesian scan on every keystroke.
  if (index < 0 || text.indexOf(anchor, index + 1) >= 0) return null
  const end = index + anchor.length
  const first = segments.find((segment) => index >= segment.start && index < segment.end)
  const last = segments.find((segment) => end > segment.start && end <= segment.end)
  if (!first || !last) return null
  const range = { from: first.pos + index - first.start, to: last.pos + end - last.start }
  return doc.textBetween(range.from, range.to, '\n') === anchor ? range : null
}
