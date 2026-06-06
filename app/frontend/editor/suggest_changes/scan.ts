import type { Node } from '@milkdown/kit/prose/model'
import { INSERTION_MARK, DELETION_MARK } from './marks'

export interface InlineSuggestion {
  id: string
  author: string
  insertedText: string
  deletedText: string
  /** Document position of the suggestion's first marked fragment. */
  from: number
  /** End position of the suggestion's last marked fragment. */
  to: number
}

const TEXT_LIMIT = 280

/**
 * Derive pending inline suggestions by scanning the doc for insertion and
 * deletion marks, grouped by suggestion id. Marks ARE the suggestion entity
 * (doc-native, no server rows) — every client derives the same list from the
 * synced document. Positions come from the marks themselves, never text
 * matching, so duplicated text can't mis-anchor a card.
 */
export function collectInlineSuggestions(doc: Node): InlineSuggestion[] {
  const byId = new Map<string, InlineSuggestion>()

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const mark of node.marks) {
      const name = mark.type.name
      if (name !== INSERTION_MARK && name !== DELETION_MARK) continue

      const id = String(mark.attrs.id)
      const author = (mark.attrs.author as string) ?? ''
      let entry = byId.get(id)
      if (!entry) {
        entry = { id, author, insertedText: '', deletedText: '', from: pos, to: pos + node.nodeSize }
        byId.set(id, entry)
      }
      if (!entry.author && author) entry.author = author
      entry.from = Math.min(entry.from, pos)
      entry.to = Math.max(entry.to, pos + node.nodeSize)

      // Strip the zero-width spaces the library inserts at block boundaries.
      const text = node.text.replace(/​/g, '')
      if (name === INSERTION_MARK && entry.insertedText.length < TEXT_LIMIT) {
        entry.insertedText = (entry.insertedText + text).slice(0, TEXT_LIMIT)
      } else if (name === DELETION_MARK && entry.deletedText.length < TEXT_LIMIT) {
        entry.deletedText = (entry.deletedText + text).slice(0, TEXT_LIMIT)
      }
    }
  })

  return [...byId.values()].sort((a, b) => a.from - b.from)
}
