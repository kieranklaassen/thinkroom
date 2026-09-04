import type { Node } from '@milkdown/kit/prose/model'
import { findTextRanges } from './suggestions'

export interface CommentRange { from: number; to: number }

/** Stored quotes have no durable identity. Never guess among occurrences,
 * including overlapping matches or duplicated multi-paragraph selections. */
export function findCommentAnchorRange(doc: Node, anchor: string | null): CommentRange | null {
  if (!anchor) return null
  const matches = findTextRanges(doc, anchor, true)
  if (matches.length) return matches.length === 1 ? matches[0] : null
  const lines = anchor.split('\n').filter(Boolean)
  if (lines.length < 2) return null
  const first = findTextRanges(doc, lines[0], true)
  const last = findTextRanges(doc, lines[lines.length - 1], true)
  let found: CommentRange | null = null
  for (const start of first) {
    for (const end of last) {
      if (end.to <= start.from || doc.textBetween(start.from, end.to, '\n') !== anchor) continue
      if (found) return null
      found = { from: start.from, to: end.to }
    }
  }
  return found
}
