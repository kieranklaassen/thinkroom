import { editorViewCtx, parserCtx, schemaCtx, type Editor } from '@milkdown/kit/core'
import {
  Fragment,
  Slice,
  type MarkType,
  type Node,
  type NodeType,
} from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { SKIP_PROVENANCE } from './provenance'
import {
  sourceParser,
  type DocumentFormat,
  type SourceParser,
} from './document_format'

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

function findTextRanges(doc: Node, search: string | null): { from: number; to: number }[] {
  if (!search) return []
  const results: { from: number; to: number }[] = []

  doc.descendants((node, pos) => {
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

    let fromIndex = 0
    while (fromIndex <= text.length - search.length) {
      const index = text.indexOf(search, fromIndex)
      if (index === -1) break
      const endIndex = index + search.length
      const startSeg = segments.find((s) => index >= s.strFrom && index < s.strTo)
      const endSeg = segments.find((s) => endIndex > s.strFrom && endIndex <= s.strTo)
      if (startSeg && endSeg) {
        results.push({
          from: startSeg.docFrom + (index - startSeg.strFrom),
          to: endSeg.docFrom + (endIndex - endSeg.strFrom),
        })
      }
      fromIndex = index + Math.max(1, search.length)
    }
    return true
  })

  return results
}

const normalizeBlockText = (text: string): string => text.replace(/\s+/g, ' ').trim()

const renderedBlockText = (node: Node): string =>
  normalizeBlockText(node.textBetween(0, node.content.size, ' ', ' '))

const isListNode = (node: Node): boolean =>
  node.type.name === 'ordered_list' || node.type.name === 'bullet_list'

interface StructuralRange {
  from: number
  to: number
  kind: 'block' | 'list'
}

/**
 * Contiguous structural windows whose block-separated rendered text matches
 * the agent-facing quote. Top-level windows cover section rewrites; partial
 * list-child windows cover adjacent list items. A nested window containing
 * every list item is excluded because the equivalent outer top-level list
 * range is the replaceable unit that permits changing the list type.
 */
function findStructuralRanges(doc: Node, searchText: string): StructuralRange[] {
  if (!searchText) return []
  const results: StructuralRange[] = []

  const visit = (parent: Node, contentStart: number) => {
    const blocks: { text: string; from: number; to: number }[] = []
    parent.forEach((child, offset) => {
      const from = contentStart + offset
      if (child.isBlock) {
        blocks.push({
          text: renderedBlockText(child),
          from,
          to: from + child.nodeSize,
        })
      }
      if (child.childCount > 0) visit(child, from + 1)
    })

    const list = isListNode(parent)
    if ((parent !== doc && !list) || blocks.length !== parent.childCount) return

    for (let start = 0; start < blocks.length; start += 1) {
      if (!blocks[start].text) continue
      let text = ''
      for (let end = start; end < blocks.length; end += 1) {
        if (list && start === 0 && end === blocks.length - 1) continue
        text = normalizeBlockText(`${text} ${blocks[end].text}`)
        if (text.length > searchText.length) break
        if (text === searchText && blocks[end].text) {
          results.push({
            from: blocks[start].from,
            to: blocks[end].to,
            kind: list ? 'list' : 'block',
          })
        }
      }
    }
  }

  visit(doc, 0)
  return results
}

interface MatchedRange {
  from: number
  to: number
  /** Inline text, top-level blocks, or a partial window of sibling list items. */
  kind: 'inline' | 'block' | 'list'
}

// Parsing a quote is deterministic for a given source string, and the margin
// measure pass re-matches every suggestion on each document change — caching
// makes the per-keystroke cost a Map lookup instead of a markdown parse.
// Cached nodes are only read for textContent/shape, so a cache entry from a
// torn-down editor's schema is still valid data.
const PARSE_CACHE_MAX = 200
const parseCache = new Map<string, Node | null>()

const parseQuote = (parser: SourceParser, cacheScope: string, search: string): Node | null => {
  const cacheKey = `${cacheScope}\u0000${search}`
  const cached = parseCache.get(cacheKey)
  if (cached !== undefined) return cached
  let parsed: Node | null = null
  try {
    parsed = parser(search) ?? null
  } catch {
    parsed = null
  }
  if (parseCache.size >= PARSE_CACHE_MAX) {
    const oldest = parseCache.keys().next().value
    if (oldest !== undefined) parseCache.delete(oldest)
  }
  parseCache.set(cacheKey, parsed)
  return parsed
}

type MatchResult =
  | { status: 'matched'; range: MatchedRange }
  | { status: 'ambiguous' }
  | { status: 'missing' }

const uniqueMatch = (
  ranges: { from: number; to: number }[],
  kind: MatchedRange['kind'],
): MatchResult => {
  if (ranges.length === 0) return { status: 'missing' }
  if (ranges.length > 1) return { status: 'ambiguous' }
  return { status: 'matched', range: { ...ranges[0], kind } }
}

const uniqueStructuralMatch = (ranges: StructuralRange[]): MatchResult => {
  if (ranges.length === 0) return { status: 'missing' }
  if (ranges.length > 1) return { status: 'ambiguous' }
  return { status: 'matched', range: ranges[0] }
}

const listReplacementContent = (parsed: Node, listItemType: NodeType | undefined) => {
  if (parsed.childCount === 1 && parsed.firstChild && isListNode(parsed.firstChild)) {
    return parsed.firstChild.content
  }
  if (!listItemType) return null
  const item = listItemType.createAndFill(null, parsed.content)
  return item ? Fragment.from(item) : null
}

/**
 * Locate suggestion-quoted text in the document. Agents quote the markdown
 * SOURCE they read from the API (`### Heading`, `**bold**`, `\~` escapes),
 * but the document only contains rendered text — so a raw string search is
 * tried first (fast path for plain-text quotes), then the quote is parsed
 * through the same Milkdown parser as the body and matched by rendered
 * text: block-sequence-wise for blocky quotes, inline for short ones.
 * Without this, "replace" silently degraded to "insert-after" and content
 * duplicated (the J3YVc161mb double-outline incident).
 */
function matchQuotedText(
  doc: Node,
  parser: SourceParser,
  cacheScope: string,
  search: string | null,
): MatchResult {
  if (!search) return { status: 'missing' }

  const raw = uniqueMatch(findTextRanges(doc, search), 'inline')
  if (raw.status !== 'missing') return raw

  const parsed = parseQuote(parser, cacheScope, search)
  if (!parsed || parsed.content.size === 0) return { status: 'missing' }

  const block = uniqueStructuralMatch(
    findStructuralRanges(doc, renderedBlockText(parsed)),
  )
  if (block.status !== 'missing') return block

  // Source-styled inline quote (e.g. `**Date:** 2026` or `<strong>Date:</strong>`)
  // inside a larger
  // paragraph: match its rendered text within a single block.
  if (parsed.childCount === 1 && parsed.firstChild?.isTextblock) {
    return uniqueMatch(
      findTextRanges(doc, normalizeBlockText(parsed.firstChild.textContent)),
      'inline',
    )
  }
  return { status: 'missing' }
}

/**
 * Where a suggestion's quoted text (replaces, else anchor) lives in the
 * doc — for margin-card placement and jump-to-anchor. Same matcher accept
 * uses, so cards anchor correctly for markdown-quoting suggestions instead
 * of stacking at the document top.
 */
export function findSuggestionTarget(
  doc: Node,
  parser: SourceParser,
  search: string | null,
  cacheScope = 'markdown',
): { from: number; to: number } | null {
  const match = matchQuotedText(doc, parser, cacheScope, search)
  return match.status === 'matched'
    ? { from: match.range.from, to: match.range.to }
    : null
}

export type SuggestionApplicability =
  | { ok: true }
  | { ok: false; reason: 'ambiguous' | 'empty' | 'missing' }

export function suggestionApplicability(
  editor: Editor,
  suggestion: SuggestionPayload,
  format: DocumentFormat,
): SuggestionApplicability {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const parser = sourceParser(format, ctx.get(parserCtx), ctx.get(schemaCtx))
    let parsed: Node | undefined
    try {
      parsed = parser(suggestion.body)
    } catch {
      return { ok: false, reason: 'empty' }
    }
    if (!parsed || parsed.content.size === 0) return { ok: false, reason: 'empty' }

    if (suggestion.replaces) {
      const match = matchQuotedText(view.state.doc, parser, format, suggestion.replaces)
      if (match.status === 'ambiguous') return { ok: false, reason: 'ambiguous' }
      if (match.status === 'missing') return { ok: false, reason: 'missing' }
      if (
        match.range.kind === 'list' &&
        !listReplacementContent(parsed, view.state.schema.nodes.list_item)
      ) {
        return { ok: false, reason: 'empty' }
      }
    }
    return { ok: true }
  })
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
 * - `replaces` matched inline + single-textblock body → inline replacement
 *   (keeps the surrounding paragraph intact — the typo-fix path)
 * - `replaces` matched as a block window → the whole window is replaced by
 *   the parsed body (section rewrites)
 * - `replaces` matched inline + multi-block body → replaceRange fits the
 *   block content around the matched text
 * - no `replaces` field → inserted after `anchor_text`'s block, else
 *   appended at the end of the document
 * - a missing or ambiguous `replaces` target → no mutation
 *
 * Returns the inserted range so callers can spotlight the merge.
 */
export function applySuggestion(
  editor: Editor,
  suggestion: SuggestionPayload,
  format: DocumentFormat = 'markdown',
): { from: number; to: number } | null {
  let applied: { from: number; to: number } | null = null

  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const parser = sourceParser(format, ctx.get(parserCtx), ctx.get(schemaCtx))
    const { state } = view
    const markType = state.schema.marks.provenance as MarkType | undefined
    if (!markType) return

    const parsed = parser(suggestion.body)
    if (!parsed || parsed.content.size === 0) return
    const bodyIsInline = parsed.childCount === 1 && Boolean(parsed.firstChild?.isTextblock)

    let tr = state.tr
    let insertFrom: number
    let insertTo: number

    const targetResult = matchQuotedText(state.doc, parser, format, suggestion.replaces)
    if (suggestion.replaces && targetResult.status !== 'matched') return
    const target = targetResult.status === 'matched' ? targetResult.range : null
    if (target && target.kind === 'inline' && bodyIsInline) {
      const inline = parsed.firstChild!.content
      tr = tr.replaceWith(target.from, target.to, inline)
      insertFrom = target.from
      insertTo = target.from + inline.size
    } else if (target && target.kind === 'list') {
      const replacement = listReplacementContent(parsed, state.schema.nodes.list_item)
      if (!replacement) return
      tr = tr.replaceWith(target.from, target.to, replacement)
      insertFrom = target.from
      insertTo = target.from + replacement.size
    } else if (target && target.kind === 'block') {
      tr = tr.replaceWith(target.from, target.to, parsed.content)
      insertFrom = target.from
      insertTo = target.from + parsed.content.size
    } else if (target) {
      // Inline match, block-shaped body: let replaceRange grow the cut to
      // fit block content (covers-whole-block matches replace the block).
      tr = tr.replaceRange(target.from, target.to, new Slice(parsed.content, 0, 0))
      insertFrom = tr.mapping.map(target.from, -1)
      insertTo = tr.mapping.map(target.to, 1)
    } else {
      const anchorResult = matchQuotedText(state.doc, parser, format, suggestion.anchor_text)
      const anchorRange = anchorResult.status === 'matched' ? anchorResult.range : null
      let insertPos = state.doc.content.size
      if (anchorRange) {
        // Block matches already end at a top-level boundary; inline matches
        // resolve to the end of their enclosing top-level block.
        const $anchor = state.doc.resolve(anchorRange.to)
        insertPos = $anchor.depth >= 1 ? $anchor.after(1) : anchorRange.to
      }
      tr = tr.insert(insertPos, parsed.content)
      insertFrom = insertPos
      insertTo = insertPos + parsed.content.size
    }

    const human = suggestion.author_kind === 'human'
    tr = tr.addMark(
      insertFrom,
      insertTo,
      markType.create(
        human
          ? { kind: 'human', author: suggestion.author_name, state: 'verbatim' }
          : { kind: 'ai', author: suggestion.author_name, state: 'pending' },
      ),
    )
    tr.setMeta(SKIP_PROVENANCE, true)
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertTo)))
    tr.scrollIntoView()
    view.dispatch(tr)
    applied = { from: insertFrom, to: insertTo }
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
