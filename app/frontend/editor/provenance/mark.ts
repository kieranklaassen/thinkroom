import { $markAttr, $markSchema, $ctx } from '@milkdown/kit/utils'

export type ProvenanceKind = 'human' | 'ai'
export type ReviewState = 'verbatim' | 'pending' | 'reviewed' | 'endorsed'

export interface ProvenanceAttrs {
  kind: ProvenanceKind
  author: string
  state: ReviewState
}

export const REVIEW_ORDER: ReviewState[] = ['pending', 'reviewed', 'endorsed']

/** Identity of the local human author, injected from React via editor config. */
export const provenanceIdentityCtx = $ctx({ name: 'Anonymous' }, 'provenanceIdentity')

export const provenanceAttr = $markAttr('provenance')

/**
 * The provenance mark: every text span carries who wrote it and, for AI text,
 * where it sits in the review lifecycle. Attrs stay plain JSON so they survive
 * y-prosemirror (marks become formatting attributes on Y.XmlText, keyed by
 * mark type name — one provenance mark per span, same-type marks replace).
 */
export const provenanceSchema = $markSchema('provenance', (ctx) => ({
  attrs: {
    kind: { default: 'human' },
    author: { default: '' },
    state: { default: 'verbatim' },
  },
  inclusive: true,
  parseDOM: [
    {
      tag: 'span[data-provenance]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return {
          kind: el.dataset.kind ?? 'human',
          author: el.dataset.author ?? '',
          state: el.dataset.state ?? 'verbatim',
        }
      },
    },
  ],
  toDOM: (mark) => [
    'span',
    {
      ...ctx.get(provenanceAttr.key)(mark),
      'data-provenance': '',
      'data-kind': mark.attrs.kind as string,
      'data-author': mark.attrs.author as string,
      'data-state': mark.attrs.state as string,
      class: `prov prov--${mark.attrs.kind} prov--${mark.attrs.state}`,
      title:
        mark.attrs.kind === 'ai'
          ? `Written by ${mark.attrs.author || 'AI'} · ${mark.attrs.state}`
          : undefined,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'provenance',
    runner: (state, node, markType) => {
      state.openMark(markType, {
        kind: (node.kind as string) ?? 'human',
        author: (node.author as string) ?? '',
        state: (node.state as string) ?? 'verbatim',
      })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'provenance',
    runner: (state, mark) => {
      state.withMark(mark, 'provenance', undefined, {
        kind: mark.attrs.kind,
        author: mark.attrs.author,
        state: mark.attrs.state,
      })
    },
  },
}))
