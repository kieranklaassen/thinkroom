import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { ySyncPluginKey } from 'y-prosemirror'

/**
 * Hard ceiling on `doc.content.size` for locally produced transactions.
 *
 * Mirrors the server's `Document::MAX_CONTENT_BYTES` (2 MiB). `content.size`
 * counts one unit per character and two per node boundary, so a document
 * above this can never serialize under the server's snapshot cap: its
 * source would be refused with 413 forever while the CRDT kept growing —
 * which is exactly how a 4 MB paste produced a 10 MB Yjs state whose saved
 * source was still the 72-byte template. Refusing the edit here keeps the
 * live state and the saved source within the same limit.
 */
export const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024

export type DocumentSizeGuardCallback = (info: { size: number; limit: number }) => void

/** React registers a callback here to tell the user an edit was refused. */
export const documentSizeGuardCtx = $ctx<
  { onRefused: DocumentSizeGuardCallback | null; limit: number },
  'documentSizeGuard'
>({ onRefused: null, limit: MAX_DOCUMENT_SIZE }, 'documentSizeGuard')

const isRemote = (tr: Transaction): boolean => Boolean(tr.getMeta(ySyncPluginKey))

/**
 * A transaction is refused when it is local, grows the document, and lands
 * above the limit. Remote (y-sync) transactions are never refused — filtering
 * them would desynchronize this replica from its peers — and neither are
 * transactions that leave an already-oversized document the same size or
 * smaller, so a user can always delete their way back under the limit.
 */
export const exceedsDocumentSize = (
  tr: Transaction,
  state: EditorState,
  limit: number,
): boolean => {
  if (!tr.docChanged || isRemote(tr)) return false
  const size = tr.doc.content.size
  return size > limit && size > state.doc.content.size
}

const documentSizeGuardProse = $prose((ctx) => {
  return new Plugin({
    key: new PluginKey('DOCUMENT_SIZE_GUARD'),
    filterTransaction: (tr, state) => {
      const { onRefused, limit } = ctx.get(documentSizeGuardCtx.key)
      if (!exceedsDocumentSize(tr, state, limit)) return true
      onRefused?.({ size: tr.doc.content.size, limit })
      return false
    },
  })
})

export const documentSizeGuard = [documentSizeGuardCtx, documentSizeGuardProse].flat()
