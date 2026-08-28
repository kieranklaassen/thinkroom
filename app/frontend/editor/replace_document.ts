import { editorViewCtx, parserCtx, schemaCtx, type Editor } from '@milkdown/kit/core'
import { getMarkdown } from '@milkdown/kit/utils'
import type { MarkType, Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { suggestChangesKey } from '@handlewithcare/prosemirror-suggest-changes'
import { SKIP_PROVENANCE } from './provenance'
import { SUGGESTION_MARK_NAMES } from './suggest_changes/marks'
import { serializeHtml, sourceParser, type DocumentFormat } from './document_format'
import { firstHeadingTitle } from './document_title'

export interface ReplaceDocumentOptions {
  /** Complete new source in the document's own format. */
  source: string
  format: DocumentFormat
  /** Agent name the replaced text is attributed to (already normalized). */
  author: string
}

export type ReplaceDocumentOutcome =
  | {
      /** The document source as it was immediately before the replacement. */
      previous: string
      /** First level-1 heading of the new document, or null. */
      title: string | null
    }
  | { error: 'empty' | 'no_provenance' }

/** Inline leaves that carry no content of their own. */
const STRUCTURAL_LEAVES = new Set(['hardbreak'])

/**
 * Both parsers turn empty or whitespace-only source into a document holding
 * one empty paragraph, so `content.size === 0` never fires. Empty means: no
 * text after trimming AND no leaf/atom node that stands on its own (image,
 * sketch, diagram, code block, rule).
 */
export function isEmptyDocument(doc: ProseNode): boolean {
  if (doc.textContent.trim() !== '') return false
  let hasLeaf = false
  doc.descendants((node) => {
    if (hasLeaf) return false
    if (node.isText) return false
    if (node.type.name === 'code_block' || node.isAtom || node.isLeaf) {
      if (!STRUCTURAL_LEAVES.has(node.type.name)) hasLeaf = true
      return false
    }
    return true
  })
  return !hasLeaf
}

/**
 * Replaces the whole document with `source` in one transaction attributed to
 * an agent as pending AI provenance. Mirrors `applySuggestion` (explicit
 * attribution + SKIP_PROVENANCE) and `attributeSeedToAgent` (doc-wide), but
 * deliberately stays in undo history and listener-visible so the title,
 * provenance chips, and debounced snapshot update exactly as for a human edit.
 *
 * Suggest-changes marks are stripped over the inserted range: the Markdown
 * parser rebuilds them from `<ins>/<del data-suggestion-id>` in canonical
 * source, and `addMark` only replaces same-type marks, so without this pass
 * stale tracked changes would survive the replacement. The transaction also
 * skips the Suggest-mode tracker so a tab in Suggest mode does not turn the
 * replacement into one giant tracked change.
 *
 * Refusals return before any dispatch; the document is untouched.
 */
export function replaceDocumentContent(
  editor: Editor,
  { source, format, author }: ReplaceDocumentOptions,
): ReplaceDocumentOutcome {
  let outcome: ReplaceDocumentOutcome = { error: 'empty' }

  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const schema = ctx.get(schemaCtx)
    const { state } = view
    const provenance = schema.marks.provenance as MarkType | undefined
    if (!provenance) {
      outcome = { error: 'no_provenance' }
      return
    }

    const parsed = sourceParser(format, ctx.get(parserCtx), schema)(source)
    if (!parsed || isEmptyDocument(parsed)) {
      outcome = { error: 'empty' }
      return
    }

    // Same serializers as buildSnapshotPayload, so `previous` round-trips
    // through this tool unchanged.
    const previous =
      format === 'html' ? serializeHtml(state.doc, schema) : getMarkdown()(ctx)

    let tr = state.tr.replaceWith(0, state.doc.content.size, parsed.content)
    const end = tr.doc.content.size
    for (const name of SUGGESTION_MARK_NAMES) {
      const markType = schema.marks[name] as MarkType | undefined
      if (markType) tr = tr.removeMark(0, end, markType)
    }
    // addMark skips parents that disallow the mark (code-block text), the
    // same exclusion human and seed attribution have.
    tr = tr.addMark(0, end, provenance.create({ kind: 'ai', author, state: 'pending' }))
    tr.setMeta(SKIP_PROVENANCE, true)
    tr.setMeta(suggestChangesKey, { skip: true })
    tr.setSelection(TextSelection.near(tr.doc.resolve(0)))
    view.dispatch(tr)

    outcome = { previous, title: firstHeadingTitle(tr.doc) }
  })

  return outcome
}
