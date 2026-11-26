import { nodesCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

const VALIDATORS: Record<string, Record<string, string>> = {
  bullet_list: { spread: 'boolean|string' },
  ordered_list: { spread: 'boolean|string' },
  list_item: { spread: 'boolean|string' },
  image: { alt: 'string|null', title: 'string|null' },
}

/**
 * The Markdown presets declare `spread` as a boolean but write it as "true" or
 * "false", and give an untitled image a null title. ProseMirror validates
 * attributes whenever a node is created, so those nodes fail to parse, and
 * y-prosemirror deletes any stored node it cannot create. Accept the values
 * that parsing produces and that stored documents already contain.
 */
const tolerateMarkdownAttributes: MilkdownPlugin = (ctx) => async () => {
  ctx.update(nodesCtx, (nodes) => nodes.map(([name, schema]) => {
    const validators = VALIDATORS[name]
    if (!validators) return [name, schema]

    const attrs = { ...schema.attrs }
    for (const [attr, validate] of Object.entries(validators)) {
      attrs[attr] = { ...attrs[attr], validate }
    }
    return [name, { ...schema, attrs }]
  }))
}

/** Each preset re-registers its nodes, so the relaxed attributes must come last. */
export const markdownPresets = [commonmark, gfm, tolerateMarkdownAttributes].flat()
