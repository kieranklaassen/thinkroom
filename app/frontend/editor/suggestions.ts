import { editorViewCtx, parserCtx, type Editor } from '@milkdown/kit/core'
import type { MarkType, Node } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { SKIP_PROVENANCE } from './provenance'

export interface SuggestionPayload {
  id: number
  author_name: string
  author_kind: string
  intent: string | null
  body: string
  anchor_text: string | null
  replaces: string | null
  status: string
  created_at: string
}

/** First within-block occurrence of `search` as a doc position range. */
export function findTextRange(
  doc: Node,
  search: string | null,
): { from: number; to: number } | null {
  if (!search) return null
  let result: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (result) return false
    if (!node.isTextblock) return true
    const index = node.textContent.indexOf(search)
    if (index !== -1) {
      result = { from: pos + 1 + index, to: pos + 1 + index + search.length }
      return false
    }
    return true
  })
  return result
}

/**
 * Merge an accepted suggestion into the live document. The inserted text
 * carries AI provenance (kind: ai, author, state: pending) so accepted
 * machine prose stays visibly machine prose until a human reviews it.
 *
 * - `replaces` present and found → the matched range is replaced
 * - `anchor_text` present and found → content inserted after that block
 * - otherwise → appended at the end of the document
 */
export function applySuggestion(editor: Editor, suggestion: SuggestionPayload): boolean {
  let applied = false

  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const parser = ctx.get(parserCtx)
    const { state } = view
    const markType = state.schema.marks.provenance as MarkType | undefined
    if (!markType) return

    const parsed = parser(suggestion.body)
    if (!parsed || parsed.content.size === 0) return

    let tr = state.tr
    let insertFrom: number
    let insertSize: number

    const replaceRange = findTextRange(state.doc, suggestion.replaces)
    if (replaceRange && parsed.childCount === 1 && parsed.firstChild?.isTextblock) {
      // Inline replacement keeps the surrounding paragraph intact.
      const inline = parsed.firstChild.content
      tr = tr.replaceWith(replaceRange.from, replaceRange.to, inline)
      insertFrom = replaceRange.from
      insertSize = inline.size
    } else {
      const anchorRange =
        replaceRange ?? findTextRange(state.doc, suggestion.anchor_text)
      let insertPos = state.doc.content.size
      if (anchorRange) {
        const $anchor = state.doc.resolve(anchorRange.to)
        insertPos = $anchor.after($anchor.depth >= 1 ? 1 : 0)
      }
      tr = tr.insert(insertPos, parsed.content)
      insertFrom = insertPos
      insertSize = parsed.content.size
    }

    tr = tr.addMark(
      insertFrom,
      insertFrom + insertSize,
      markType.create({
        kind: 'ai',
        author: suggestion.author_name,
        state: 'pending',
      }),
    )
    tr.setMeta(SKIP_PROVENANCE, true)
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertFrom + insertSize)))
    tr.scrollIntoView()
    view.dispatch(tr)
    applied = true
  })

  return applied
}

/** Selected text in the editor, for Ask AI context / rewrite mode. */
export function selectedText(editor: Editor): string {
  let text = ''
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    text = view.state.doc.textBetween(from, to, '\n')
  })
  return text
}
