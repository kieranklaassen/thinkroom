import { editorViewCtx, parserCtx, type Editor } from '@milkdown/kit/core'
import { Slice, type MarkType, type Node } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { SKIP_PROVENANCE } from './provenance'

/** The Milkdown parser's call shape — markdown source in, doc node out. */
type MarkdownParser = (markdown: string) => Node | undefined

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

const normalizeBlockText = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Normalized plain text of each top-level block in a parsed fragment. */
const blockTexts = (parsed: Node): string[] => {
  const texts: string[] = []
  parsed.forEach((child) => texts.push(normalizeBlockText(child.textContent)))
  return texts
}

/**
 * First contiguous window of top-level doc blocks whose rendered text
 * matches `searchTexts` block-for-block (whitespace-normalized, full-block
 * equality). Returns the doc range spanning the window.
 */
function findBlockRange(doc: Node, searchTexts: string[]): { from: number; to: number } | null {
  if (searchTexts.length === 0 || searchTexts.every((t) => t === '')) return null
  const blocks: { text: string; from: number; to: number }[] = []
  doc.forEach((child, offset) => {
    blocks.push({
      text: normalizeBlockText(child.textContent),
      from: offset,
      to: offset + child.nodeSize,
    })
  })
  for (let i = 0; i + searchTexts.length <= blocks.length; i += 1) {
    let matched = true
    for (let j = 0; j < searchTexts.length; j += 1) {
      if (blocks[i + j].text !== searchTexts[j]) {
        matched = false
        break
      }
    }
    if (matched) {
      return { from: blocks[i].from, to: blocks[i + searchTexts.length - 1].to }
    }
  }
  return null
}

interface MatchedRange {
  from: number
  to: number
  /** 'inline' = within one textblock; 'block' = a window of whole blocks. */
  kind: 'inline' | 'block'
}

// Parsing a quote is deterministic for a given source string, and the margin
// measure pass re-matches every suggestion on each document change — caching
// makes the per-keystroke cost a Map lookup instead of a markdown parse.
// Cached nodes are only read for textContent/shape, so a cache entry from a
// torn-down editor's schema is still valid data.
const PARSE_CACHE_MAX = 200
const parseCache = new Map<string, Node | null>()

const parseQuote = (parser: MarkdownParser, search: string): Node | null => {
  const cached = parseCache.get(search)
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
  parseCache.set(search, parsed)
  return parsed
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
  parser: MarkdownParser,
  search: string | null,
): MatchedRange | null {
  if (!search) return null

  const raw = findTextRange(doc, search)
  if (raw) return { ...raw, kind: 'inline' }

  const parsed = parseQuote(parser, search)
  if (!parsed || parsed.content.size === 0) return null

  const block = findBlockRange(doc, blockTexts(parsed))
  if (block) return { ...block, kind: 'block' }

  // Markdown-styled inline quote (e.g. `**Date:** 2026`) inside a larger
  // paragraph: match its rendered text within a single block.
  if (parsed.childCount === 1 && parsed.firstChild?.isTextblock) {
    const inline = findTextRange(doc, normalizeBlockText(parsed.firstChild.textContent))
    if (inline) return { ...inline, kind: 'inline' }
  }
  return null
}

/**
 * Where a suggestion's quoted text (replaces, else anchor) lives in the
 * doc — for margin-card placement and jump-to-anchor. Same matcher accept
 * uses, so cards anchor correctly for markdown-quoting suggestions instead
 * of stacking at the document top.
 */
export function findSuggestionTarget(
  doc: Node,
  parser: MarkdownParser,
  search: string | null,
): { from: number; to: number } | null {
  const match = matchQuotedText(doc, parser, search)
  return match ? { from: match.from, to: match.to } : null
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
 * - no `replaces` match → inserted after `anchor_text`'s block, else
 *   appended at the end of the document. The old content is only ever left
 *   in place when `replaces` genuinely matched nothing.
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
    const bodyIsInline = parsed.childCount === 1 && Boolean(parsed.firstChild?.isTextblock)

    let tr = state.tr
    let insertFrom: number
    let insertTo: number

    const target = matchQuotedText(state.doc, parser, suggestion.replaces)
    if (target && target.kind === 'inline' && bodyIsInline) {
      const inline = parsed.firstChild!.content
      tr = tr.replaceWith(target.from, target.to, inline)
      insertFrom = target.from
      insertTo = target.from + inline.size
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
      const anchorRange = matchQuotedText(state.doc, parser, suggestion.anchor_text)
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
