import type { Ctx } from '@milkdown/kit/ctx'
import { hardbreakAttr, hardbreakSchema } from '@milkdown/kit/preset/commonmark'

/**
 * Soft breaks (single newlines in markdown source) parse into `hardbreak`
 * nodes flagged `isInline: true` — Milkdown's commonmark preset keeps them
 * in the document so they round-trip back to "\n", but renders them as a
 * span containing a single space. That collapses agent-authored metadata
 * blocks like `**Date:** …\n**Source:** …` into one run-on paragraph.
 *
 * Render them as a real `<br>` instead. Serialization is untouched:
 * `isInline` breaks still emit "\n" and explicit hard breaks still emit
 * `\`, so document sources never change shape — only the display does.
 */
export const renderSoftBreaks = (ctx: Ctx): void => {
  ctx.update(hardbreakSchema.key, (prev) => (innerCtx) => {
    const spec = prev(innerCtx)
    return {
      ...spec,
      toDOM: (node) => ['br', innerCtx.get(hardbreakAttr.key)(node)],
      parseDOM: [
        {
          tag: 'br[data-is-inline="true"]',
          getAttrs: () => ({ isInline: true }),
        },
        ...(spec.parseDOM ?? []),
      ],
    }
  })
}
