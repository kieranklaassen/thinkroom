import type { Node } from '@milkdown/kit/prose/model'
import { findTextRange } from './suggestions'

/**
 * Selection-toolbar comments over multiple paragraphs store the anchor as
 * `textBetween(from, to, '\n')`, which the within-block matcher can never
 * find. Locate the first and last lines separately and accept the span only
 * when the text between them reproduces the anchor exactly — a false hit on
 * a duplicated first line fails that check and resolves to nothing.
 */
function findMultiBlockRange(
  doc: Node,
  anchor: string,
): { from: number; to: number } | null {
  const lines = anchor.split('\n').filter((line) => line.length > 0)
  if (lines.length < 2) return null
  const first = findTextRange(doc, lines[0])
  const last = findTextRange(doc, lines[lines.length - 1])
  if (!first || !last || last.to <= first.from) return null
  if (doc.textBetween(first.from, last.to, '\n') !== anchor) return null
  return { from: first.from, to: last.to }
}

/**
 * Where a comment's anchor text lives in the doc: first within-block
 * occurrence (the historical comment behavior), else the multi-block span
 * a cross-paragraph selection produced. Used for composer placement, the
 * draft highlight, and the rail cards' anchor tint/hover/jump.
 */
export const findCommentAnchorRange = (
  doc: Node,
  anchor: string | null,
): { from: number; to: number } | null => {
  if (!anchor) return null
  return findTextRange(doc, anchor) ?? findMultiBlockRange(doc, anchor)
}
