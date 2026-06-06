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

/**
 * First within-block occurrence of `search` as a doc position range.
 *
 * Maps string offsets through a per-text-child segment table rather than
 * assuming 1 char == 1 position: inline leaf nodes (hard breaks, images)
 * contribute nothing to textContent but occupy a document position each,
 * which would otherwise shift every anchor after them.
 */
export function findTextRange(
  doc: Node,
  search: string | null,
): { from: number; to: number } | null {
  if (!search) return null
  let result: { from: number; to: number } | null = null

  doc.descendants((node, pos) => {
    if (result) return false
    if (!node.isTextblock) return true

    let text = ''
    const segments: { strFrom: number; strTo: number; docFrom: number }[] = []
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        segments.push({
          strFrom: text.length,
          strTo: text.length + child.text.length,
          docFrom: pos + 1 + offset,
        })
        text += child.text
      }
    })

    const index = text.indexOf(search)
    if (index === -1) return true

    const endIndex = index + search.length
    const startSeg = segments.find((s) => index >= s.strFrom && index < s.strTo)
    const endSeg = segments.find((s) => endIndex > s.strFrom && endIndex <= s.strTo)
    if (!startSeg || !endSeg) return true

    result = {
      from: startSeg.docFrom + (index - startSeg.strFrom),
      to: endSeg.docFrom + (endIndex - endSeg.strFrom),
    }
    return false
  })
  return result
}

/**
 * Merge an accepted suggestion into the live document. The inserted text
 * carries provenance matching its author kind: machine authors (ai/agent)
 * get `kind: ai, state: pending` so accepted machine prose stays visibly
 * machine prose until a human reviews it; human authors get the same marks
 * the provenance writer applies to typed text (`kind: human, state:
 * verbatim`) — human prose must never inflate the AI percentages or enter
 * the AI review-state machinery (which keys on kind === 'ai').
 *
 * - `replaces` present and found → the matched range is replaced
 * - `anchor_text` present and found → content inserted after that block
 * - otherwise → appended at the end of the document
 *
 * Returns the inserted range so callers can spotlight the merge.
 */
export function applySuggestion(
  editor: Editor,
  suggestion: SuggestionPayload,
): { from: number; to: number } | null {
  let applied: { from: number; to: number } | null = null

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

    const human = suggestion.author_kind === 'human'
    tr = tr.addMark(
      insertFrom,
      insertFrom + insertSize,
      markType.create(
        human
          ? { kind: 'human', author: suggestion.author_name, state: 'verbatim' }
          : { kind: 'ai', author: suggestion.author_name, state: 'pending' },
      ),
    )
    tr.setMeta(SKIP_PROVENANCE, true)
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertFrom + insertSize)))
    tr.scrollIntoView()
    view.dispatch(tr)
    applied = { from: insertFrom, to: insertFrom + insertSize }
  })

  return applied
}

/**
 * One-beat pulse on freshly merged text: a strong tint that steps down to
 * resting and clears (~600ms). Highlight pseudo-elements can't transition,
 * so the fade is two steps — still reads as a single ease-out pulse.
 */
export function flashMergedRange(editor: Editor, range: { from: number; to: number }): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    try {
      const start = view.domAtPos(range.from)
      const end = view.domAtPos(range.to)
      const dom = document.createRange()
      dom.setStart(start.node, start.offset)
      dom.setEnd(end.node, end.offset)
      CSS.highlights.set('sug-merged', new Highlight(dom))
      setTimeout(() => {
        CSS.highlights.delete('sug-merged')
        CSS.highlights.set('sug-merged-soft', new Highlight(dom))
      }, 260)
      setTimeout(() => CSS.highlights.delete('sug-merged-soft'), 620)
    } catch {
      // best-effort flourish — never let it break an accept
    }
  })
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
