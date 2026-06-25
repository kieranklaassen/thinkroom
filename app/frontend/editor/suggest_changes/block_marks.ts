import { nodesCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'

const SUGGESTION_MARKS = ['insertion', 'modification', 'deletion']

const withSuggestionMarks = (marks: string | undefined): string => {
  if (marks === '_') return marks
  return Array.from(new Set([...(marks?.split(/\s+/).filter(Boolean) ?? []), ...SUGGESTION_MARKS]))
    .join(' ')
}

/**
 * The suggest-changes transform uses node marks for whole-block edits. Every
 * parent that accepts block children must therefore allow suggestion marks,
 * including nested containers such as list items and table cells. ProseMirror
 * otherwise rejects a marked child before the transformed transaction lands.
 */
export const allowBlockSuggestionMarks: MilkdownPlugin = (ctx) => async () => {
  ctx.update(nodesCtx, (nodes) => nodes.map(([name, schema]) => {
    const content = schema.content
    const containsBlockChildren = content && !/(?:^|\W)(?:inline|text)(?:\W|$)/.test(content)
    if (!containsBlockChildren) return [name, schema]

    return [name, { ...schema, marks: withSuggestionMarks(schema.marks) }]
  }))
}
