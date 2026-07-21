import { $markAttr, $markSchema } from '@milkdown/kit/utils'
import { DEFAULT_HIGHLIGHT_COLOR, isHighlightColorId } from './palette'

export const highlighterAttr = $markAttr('highlighter')

/**
 * The highlighter mark: a marker-style background tint from the fixed
 * palette. One mark type means y-prosemirror's same-type replacement gives
 * "one color per span" semantics for free (the provenance property). The
 * class doubles the data attributes for the live editor; the static preview
 * relies on the data attributes alone because the sanitizer strips classes.
 */
export const highlighterSchema = $markSchema('highlighter', (ctx) => ({
  attrs: {
    color: { default: DEFAULT_HIGHLIGHT_COLOR },
  },
  parseDOM: [
    {
      tag: 'span[data-highlighter]',
      getAttrs: (dom) => {
        const color = (dom as HTMLElement).dataset.color ?? ''
        return isHighlightColorId(color) ? { color } : false
      },
    },
  ],
  toDOM: (mark) => [
    'span',
    {
      ...ctx.get(highlighterAttr.key)(mark),
      'data-highlighter': '',
      'data-color': mark.attrs.color as string,
      class: `hl hl--${mark.attrs.color}`,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'highlighter',
    runner: (state, node, markType) => {
      state.openMark(markType, {
        color: (node.color as string) ?? DEFAULT_HIGHLIGHT_COLOR,
      })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlighter',
    runner: (state, mark) => {
      state.withMark(mark, 'highlighter', undefined, {
        color: mark.attrs.color,
      })
    },
  },
}))
