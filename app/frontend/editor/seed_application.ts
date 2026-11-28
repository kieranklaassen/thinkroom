import type * as Y from 'yjs'
import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { collabServiceCtx } from '@milkdown/plugin-collab'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { CableProvider } from './cable_provider'
import { htmlDefaultValue, type DocumentFormat } from './document_format'
import { SKIP_PROVENANCE } from './provenance'
import { buildSnapshotPayload } from './snapshots'

// Attributes a freshly seeded document to its agent author. applyTemplate
// writes the Yjs fragment directly; the content reaches the ProseMirror view
// via ySyncPlugin's init render (a remote-tagged transaction the provenance
// writer skips), so seeded text lands unmarked — and collectSpans counts
// unmarked text as human. This mirrors applySuggestion's explicit-attribution
// + SKIP_PROVENANCE pattern, doc-wide. Only unmarked text is touched: if
// applyTemplate no-opped against another seeder's content, that content
// already carries marks and this dispatches nothing.
function attributeSeedToAgent(view: EditorView, author: string): void {
  const markType = view.state.schema.marks.provenance
  if (!markType) return

  let tr = view.state.tr
  let changed = false
  view.state.doc.descendants((node, pos, parent) => {
    if (!node.isText) return
    if (parent && !parent.type.allowsMarkType(markType)) return
    if (markType.isInSet(node.marks)) return
    tr = tr.addMark(
      pos,
      pos + node.nodeSize,
      markType.create({ kind: 'ai', author, state: 'pending' }),
    )
    changed = true
  })

  if (!changed) return
  tr.setMeta(SKIP_PROVENANCE, true)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

/**
 * Connects the bound Yjs doc to the view, applying, attributing and persisting
 * the provider's seed when it holds one.
 */
export function connectWithSeed(
  ctx: Ctx,
  ydoc: Y.Doc,
  provider: CableProvider,
  contentFormat: DocumentFormat,
  onAttributed: (view: EditorView) => void,
): void {
  const service = ctx.get(collabServiceCtx)
  // Consume the seed one-shot: capture to locals before nulling so a
  // remounted editor never re-applies or re-attributes, and a later
  // refactor can't clear the author fields out from under the re-mark.
  const seed = provider.seedContent
  const seedFormat = provider.seedFormat
  const seedKind = provider.seedAuthorKind
  const seedAuthor = provider.seedAuthorName
  provider.seedContent = null
  provider.seedAuthorKind = null
  provider.seedAuthorName = null
  if (!seed) {
    service.connect()
    return
  }

  // Server granted this client the seed claim; the default condition
  // (remote doc empty) double-guards against racing another seeder.
  service.applyTemplate(seedFormat === 'html' ? htmlDefaultValue(seed, 'external') : seed)
  service.connect()
  if (seedKind && seedKind !== 'human') {
    // Must run after connect(): only then has ySyncPlugin rendered
    // the seeded Yjs content into the view. The dispatched marks flow
    // back through the binding, so peers receive attributed content.
    const view = ctx.get(editorViewCtx)
    attributeSeedToAgent(view, seedAuthor ?? '')
    // The updated listener skips addToHistory:false transactions, so
    // the chip never sees the marked doc on its own — push directly.
    onAttributed(view)
  }
  // Persist the applied (and attributed) seed NOW over HTTP
  // (keepalive when it fits) instead of waiting for the cable handshake. The cable
  // path drops local updates until 'sync' arrives, so a claimant that
  // navigated away within the first seconds burned the seed claim and
  // left the document blank for every viewer until the claim timeout.
  // The sync_update endpoint also broadcasts, so already-connected
  // viewers receive the seeded content live.
  provider.persistCurrentState(buildSnapshotPayload(ctx, ydoc, contentFormat))
}
