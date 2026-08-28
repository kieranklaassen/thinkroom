import type { Node as ProseNode } from '@milkdown/kit/prose/model'

/**
 * The document title is its first level-1 heading, whitespace-collapsed and
 * capped to the server's 255-character limit; `null` when there is none.
 * Shared by the editor's title listener and the in-page replace tool so both
 * report the same title the snapshot will derive.
 */
export function firstHeadingTitle(doc: ProseNode): string | null {
  let title: string | null = null
  doc.descendants((node) => {
    if (node.type.name !== 'heading' || node.attrs.level !== 1) return title === null

    title = node.textContent.replace(/\s+/g, ' ').trim().slice(0, 255) || null
    return false
  })
  return title
}
