import { $markSchema } from '@milkdown/kit/utils'
import {
  insertion as baseInsertion,
  deletion as baseDeletion,
  modification as baseModification,
} from '@handlewithcare/prosemirror-suggest-changes'

export interface SuggestionMarkAttrs {
  id: string | number
  author: string
}

/** Single source of truth for the track-changes mark type names — consumed
 *  by the guard plugin, the doc scan, and the provenance summary so a rename
 *  or addition never needs hunting through call sites. */
export const INSERTION_MARK = 'insertion'
export const DELETION_MARK = 'deletion'
export const MODIFICATION_MARK = 'modification'
export const SUGGESTION_MARK_NAMES: string[] = [INSERTION_MARK, DELETION_MARK, MODIFICATION_MARK]

/**
 * Track-changes marks for Suggest mode, extending the library specs with an
 * `author` attr so attribution syncs through y-prosemirror as part of the
 * mark (marks become formatting attributes on Y.XmlText — every client sees
 * the same pending suggestions). DOM and markdown serialization use
 * `data-suggestion-id` so plain <ins>/<del> in pasted HTML is never hijacked.
 */
export const insertionSchema = $markSchema('insertion', () => ({
  ...baseInsertion,
  attrs: {
    id: { default: 0, validate: 'number|string' },
    author: { default: '' },
  },
  parseDOM: [
    {
      tag: 'ins[data-suggestion-id]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return {
          id: el.dataset.suggestionId ?? 0,
          author: el.dataset.author ?? '',
        }
      },
    },
  ],
  toDOM: (mark) => [
    'ins',
    {
      'data-suggestion-id': String(mark.attrs.id),
      'data-author': mark.attrs.author as string,
      class: 'sug-ins',
      title: `Suggested by ${(mark.attrs.author as string) || 'someone'}`,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'suggestInsertion',
    runner: (state, node, markType) => {
      state.openMark(markType, {
        id: (node.suggestionId as string) ?? 0,
        author: (node.author as string) ?? '',
      })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'insertion',
    runner: (state, mark) => {
      state.withMark(mark, 'suggestInsertion', undefined, {
        suggestionId: String(mark.attrs.id),
        author: mark.attrs.author,
      })
    },
  },
}))

export const deletionSchema = $markSchema('deletion', () => ({
  ...baseDeletion,
  attrs: {
    id: { default: 0, validate: 'number|string' },
    author: { default: '' },
  },
  parseDOM: [
    {
      tag: 'del[data-suggestion-id]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return {
          id: el.dataset.suggestionId ?? 0,
          author: el.dataset.author ?? '',
        }
      },
    },
  ],
  toDOM: (mark) => [
    'del',
    {
      'data-suggestion-id': String(mark.attrs.id),
      'data-author': mark.attrs.author as string,
      class: 'sug-del',
      title: `Deletion suggested by ${(mark.attrs.author as string) || 'someone'}`,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'suggestDeletion',
    runner: (state, node, markType) => {
      state.openMark(markType, {
        id: (node.suggestionId as string) ?? 0,
        author: (node.author as string) ?? '',
      })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'deletion',
    runner: (state, mark) => {
      state.withMark(mark, 'suggestDeletion', undefined, {
        suggestionId: String(mark.attrs.id),
        author: mark.attrs.author,
      })
    },
  },
}))

/**
 * The library's step transforms require a `modification` mark in the schema
 * (formatting/attr changes in suggest mode). v1 keeps it registered but
 * serialization-transparent: its content passes through to markdown with no
 * wrapper, so it never throws the serializer; round-trip fidelity for
 * formatting suggestions is a known v1 gap (insertion/deletion are the core).
 */
export const modificationSchema = $markSchema('modification', () => ({
  ...baseModification,
  parseMarkdown: {
    match: () => false,
    runner: () => {},
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'modification',
    runner: (state, mark) => {
      // Pass-through: keep the content, drop the wrapper.
      state.withMark(mark, 'suggestModification', undefined, {})
    },
  },
}))
