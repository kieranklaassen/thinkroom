import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

/**
 * Marks the editor root once the document is long enough that rendering every
 * block up front costs more than it is worth. styles/editor.css keys the
 * content-visibility rules on this class, so short documents keep the exact
 * layout behaviour they had (no placeholders, no jump settling) and long ones
 * only pay for the blocks on screen.
 */
export const LONG_DOCUMENT_BLOCKS = 150
export const LONG_DOCUMENT_CLASS = 'is-long-document'

const longDocumentKey = new PluginKey('LONG_DOCUMENT')

const longDocumentProse = $prose(
  () =>
    new Plugin({
      key: longDocumentKey,
      props: {
        attributes: (state): Record<string, string> =>
          state.doc.childCount >= LONG_DOCUMENT_BLOCKS ? { class: LONG_DOCUMENT_CLASS } : {},
      },
    }),
)

export const longDocument = [longDocumentProse].flat()
