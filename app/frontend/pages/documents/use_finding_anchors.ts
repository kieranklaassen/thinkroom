import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorHandle } from '../../editor/milkdown_editor'
import {
  codepointOffsetToIndex,
  paragraphRange,
  paragraphSlice,
  projectParagraphs,
  type ProjectedParagraph,
} from '../../editor/paragraph_projection'
import { clearHighlight, domRange, setHighlight } from '../../lib/highlights'
import type { WritingFindingPayload } from '../../types/payloads'

export interface FindingRange { from: number; to: number }

export interface AnchoredParagraph {
  /** ProseMirror position of the block, the card's measurement anchor. */
  pos: number
  index: number
  findings: WritingFindingPayload[]
}

interface Options {
  findings: WritingFindingPayload[]
  handle: EditorHandle | null
  /** Re-resolves anchors on local and remote document changes. */
  docTick: number
  /** Reviewer keys whose findings paint; others stay resolved but hidden. */
  visibleKeys: Set<string>
  /** Compound mode paints; other modes clear every cw-* highlight. */
  active: boolean
}

export interface FindingAnchors {
  /** Findings whose text still resolves, by id. Null before the first measure. */
  anchoredIds: Set<number> | null
  /** Anchored findings whose paragraph text no longer matches the stored copy. */
  changedIds: Set<number>
  /** Visible anchored findings grouped by their current paragraph. */
  paragraphs: AnchoredParagraph[]
  hoverFinding: (finding: WritingFindingPayload | null) => void
  jumpToFinding: (finding: WritingFindingPayload) => void
}

const HOT = 'cw-hot'
const FILL_PRIORITY = 2
const UNDER_PRIORITY = 1
const HOT_PRIORITY = 3

// One text→blocks index per document version.
const paragraphIndexes = new WeakMap<Node, Map<string, ProjectedParagraph[]>>()

function indexByText(doc: Node): Map<string, ProjectedParagraph[]> {
  const cached = paragraphIndexes.get(doc)
  if (cached) return cached
  const map = new Map<string, ProjectedParagraph[]>()
  for (const paragraph of projectParagraphs(doc)) {
    const list = map.get(paragraph.text)
    if (list) list.push(paragraph)
    else map.set(paragraph.text, [paragraph])
  }
  paragraphIndexes.set(doc, map)
  return map
}

function occurrences(haystack: string, needle: string): number[] {
  const hits: number[] = []
  let at = haystack.indexOf(needle)
  while (at >= 0 && hits.length < 2) {
    hits.push(at)
    at = haystack.indexOf(needle, at + 1)
  }
  return hits
}

/**
 * Three-step resolution (plan KTD3): an identical paragraph maps the stored
 * offset (a repeated paragraph must sit at the stored index, or the finding
 * is changed rather than guessed); else the block at the stored index
 * re-anchors the quote when it occurs there exactly once; else the finding
 * is changed. A finding never moves to another paragraph.
 */
export function resolveFinding(
  doc: Node,
  finding: WritingFindingPayload,
): { range: FindingRange; paragraph: ProjectedParagraph } | null {
  if (finding.paragraph_text === null || finding.quote === null || finding.quote_offset === null) return null
  const quote = finding.quote
  // Verify against the projection, the text the server judged: a quote that
  // spans a hard break or image carries the projection's `\n`, and the
  // projection is also what textBetween's leafText would have to reproduce.
  const verify = (paragraph: ProjectedParagraph, offset: number) => {
    if (paragraphSlice(paragraph, offset, quote.length) !== quote) return null
    const range = paragraphRange(paragraph, offset, quote.length)
    return range ? { range, paragraph } : null
  }
  const identical = indexByText(doc).get(finding.paragraph_text) ?? []
  const same = identical.length === 1 ? identical[0] : identical.find((candidate) => candidate.index === finding.paragraph_index)
  if (same) {
    const resolved = verify(same, codepointOffsetToIndex(same.text, finding.quote_offset))
    if (resolved) return resolved
  }
  const atIndex = finding.paragraph_index === null ? undefined : projectParagraphs(doc)[finding.paragraph_index]
  if (atIndex) {
    const hits = occurrences(atIndex.text, finding.quote)
    if (hits.length === 1) return verify(atIndex, hits[0])
  }
  return null
}

/**
 * Connects writing findings to the text they judge and paints them with the
 * CSS Custom Highlight API: phrase findings fill, sentence findings underline,
 * and when two phrase findings overlap the lower probability demotes to its
 * reviewer's underline so both stay legible (plan KTD6).
 */
export function useFindingAnchors({ findings, handle, docTick, visibleKeys, active }: Options): FindingAnchors {
  const domRangesRef = useRef(new Map<number, Range>())
  const [paragraphs, setParagraphs] = useState<AnchoredParagraph[]>([])
  const [anchoredIds, setAnchoredIds] = useState<Set<number> | null>(null)
  const hoveredIdRef = useRef<number | null>(null)
  const highlightNamesRef = useRef(new Set<string>())
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearAll = useCallback(() => {
    for (const name of highlightNamesRef.current) clearHighlight(name)
    highlightNamesRef.current.clear()
    clearHighlight(HOT)
  }, [])

  useLayoutEffect(() => {
    if (!handle || !active) {
      // Other modes neither paint nor measure: findings resolve again on entry.
      domRangesRef.current.clear()
      setParagraphs([])
      setAnchoredIds(null)
      clearAll()
      return
    }
    let view: EditorView
    try {
      view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
    } catch {
      return // editor torn down mid-navigation
    }
    const doc = view.state.doc
    const nextIds = new Set<number>()
    const nextDom = new Map<number, Range>()
    const grouped = new Map<number, AnchoredParagraph>()
    const painted: Array<{ finding: WritingFindingPayload; range: FindingRange; dom: Range }> = []
    // Two identical paragraphs judged separately collapse onto one when the
    // other is deleted; show that reviewer's verdict once, not twice.
    const shown = new Set<string>()
    for (const finding of findings) {
      if (finding.scope === 'text') continue
      const resolved = resolveFinding(doc, finding)
      if (!resolved) continue
      nextIds.add(finding.id)
      const dom = domRange(view, resolved.range.from, resolved.range.to)
      if (dom) nextDom.set(finding.id, dom)
      if (!visibleKeys.has(finding.reviewer_key)) continue
      const shownKey = `${finding.reviewer_key}|${finding.question_id}|${resolved.range.from}|${resolved.range.to}`
      if (shown.has(shownKey)) continue
      shown.add(shownKey)
      const group = grouped.get(resolved.paragraph.pos) ?? { pos: resolved.paragraph.pos, index: resolved.paragraph.index, findings: [] }
      group.findings.push(finding)
      grouped.set(resolved.paragraph.pos, group)
      if (dom && finding.scope !== 'paragraph') painted.push({ finding, range: resolved.range, dom })
    }
    domRangesRef.current = nextDom
    setParagraphs([...grouped.values()].sort((a, b) => a.pos - b.pos))
    setAnchoredIds((prev) => {
      if (prev && prev.size === nextIds.size && [...nextIds].every((id) => prev.has(id))) return prev
      return nextIds
    })

    clearAll()
    // Fill wins by probability; an overlapped lower phrase becomes an underline.
    const fills: FindingRange[] = []
    const byName = new Map<string, Range[]>()
    const paint = (name: string, dom: Range) => {
      const list = byName.get(name)
      if (list) list.push(dom)
      else byName.set(name, [dom])
    }
    painted.sort((a, b) => b.finding.probability - a.finding.probability)
    for (const { finding, range, dom } of painted) {
      if (finding.scope === 'phrase' && !fills.some((fill) => fill.from < range.to && range.from < fill.to)) {
        fills.push(range)
        paint(`cw-${finding.reviewer_key}-fill`, dom)
      } else {
        paint(`cw-${finding.reviewer_key}-under`, dom)
      }
    }
    for (const [name, list] of byName) {
      setHighlight(name, list, name.endsWith('-fill') ? FILL_PRIORITY : UNDER_PRIORITY)
      highlightNamesRef.current.add(name)
    }
    const hovered = hoveredIdRef.current === null ? undefined : nextDom.get(hoveredIdRef.current)
    if (hovered) setHighlight(HOT, [hovered], HOT_PRIORITY)
    // docTick re-resolves anchors after document changes.
  }, [findings, handle, visibleKeys, active, docTick, clearAll])

  useEffect(() => {
    const timers = flashTimers.current
    return () => {
      timers.forEach(clearTimeout)
      clearAll()
    }
  }, [clearAll])

  const changedIds = useMemo(() => {
    const changed = new Set<number>()
    if (anchoredIds === null || !active) return changed
    for (const finding of findings) {
      if (finding.scope !== 'text' && !anchoredIds.has(finding.id)) changed.add(finding.id)
    }
    return changed
  }, [findings, anchoredIds, active])

  const hoverFinding = useCallback((finding: WritingFindingPayload | null) => {
    hoveredIdRef.current = finding === null ? null : finding.id
    const range = finding === null ? undefined : domRangesRef.current.get(finding.id)
    if (range) setHighlight(HOT, [range], HOT_PRIORITY)
    else clearHighlight(HOT)
  }, [])

  const jumpToFinding = useCallback((finding: WritingFindingPayload) => {
    const range = domRangesRef.current.get(finding.id)
    if (!range) return
    // Scroll without touching the ProseMirror selection (see jumpToComment).
    const start = range.startContainer
    const startEl = start instanceof Element ? start : start.parentElement
    startEl?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
    flashTimers.current.forEach(clearTimeout)
    flashTimers.current.length = 0
    setHighlight(HOT, [range], HOT_PRIORITY)
    flashTimers.current.push(setTimeout(() => {
      if (hoveredIdRef.current !== finding.id) clearHighlight(HOT)
    }, 900))
  }, [])

  return { anchoredIds, changedIds, paragraphs, hoverFinding, jumpToFinding }
}
