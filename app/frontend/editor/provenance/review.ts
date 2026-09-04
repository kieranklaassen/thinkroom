import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node } from '@milkdown/kit/prose/model'
import { collabSyncState, fromRelativePosition, toRelativePosition } from '../collab_positions'
import { INSERTION_MARK } from '../suggest_changes/marks'
import { REVIEW_ORDER, type ProvenanceAttrs, type ReviewState } from './mark'
import { SKIP_PROVENANCE } from './writer'

export interface AiSpan {
  from: number
  to: number
  attrs: ProvenanceAttrs
}

export type ProvenanceFilter = 'human' | 'ai' | 'unreviewed'

const sameAttrs = (a: ProvenanceAttrs, b: ProvenanceAttrs): boolean =>
  a.kind === b.kind && a.author === b.author && a.state === b.state

/** Actual text intervals, never joined across blocks or pending insertions. */
export function provenanceRanges(doc: Node): AiSpan[] {
  const ranges: AiSpan[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || node.marks.some((m) => m.type.name === INSERTION_MARK)) return
    const mark = node.marks.find((m) => m.type.name === 'provenance')
    const attrs = (mark?.attrs ?? { kind: 'human', author: '', state: 'verbatim' }) as ProvenanceAttrs
    const last = ranges[ranges.length - 1]
    if (last && last.to === pos && sameAttrs(last.attrs, attrs)) last.to += node.nodeSize
    else ranges.push({ from: pos, to: pos + node.nodeSize, attrs })
  })
  return ranges
}

/** One fresh search per activation; wrapping is not persistent traversal state. */
export function nextProvenanceRange(state: EditorState, filter: ProvenanceFilter): AiSpan | null {
  const ranges = provenanceRanges(state.doc).filter(({ attrs }) =>
    filter === 'unreviewed' ? attrs.kind === 'ai' && attrs.state === 'pending' : attrs.kind === filter,
  )
  return ranges.find((range) => state.selection.empty
    ? range.from > state.selection.head
    : range.from >= state.selection.to) ?? ranges[0] ?? null
}

/** The complete contiguous AI run at the cursor, including formatting splits. */
export function aiSpanAt(state: EditorState): AiSpan | null {
  const head = state.selection.$head
  const mark = head.marks().find((m) => m.type.name === 'provenance' && m.attrs.kind === 'ai')
  if (!mark) return null
  return provenanceRanges(state.doc).find((range) =>
    range.from <= head.pos && range.to >= head.pos && sameAttrs(range.attrs, mark.attrs as ProvenanceAttrs),
  ) ?? null
}

export function nextReviewState(current: ReviewState): ReviewState | null {
  const index = REVIEW_ORDER.indexOf(current)
  return index < 0 ? null : REVIEW_ORDER[index + 1] ?? null
}

/** A target is scoped to one collaboration session and the exact original text. */
export function bindReviewTarget(state: EditorState, span: AiSpan) {
  const from = toRelativePosition(state, span.from)
  const to = toRelativePosition(state, span.to, -1)
  const doc = collabSyncState(state)?.doc
  if (!from || !to || !doc) return null
  return { from, to, doc, text: state.doc.textBetween(span.from, span.to, '\n'), attrs: span.attrs, invalid: false }
}
export type ReviewTarget = NonNullable<ReturnType<typeof bindReviewTarget>>

/** Never rebind an orphan to a matching neighbor, even after an undo. */
export function resolveReviewTarget(state: EditorState, target: ReviewTarget): AiSpan | null {
  if (target.invalid) return null
  const sync = collabSyncState(state)
  const from = sync?.doc === target.doc ? fromRelativePosition(state, target.from, sync) : null
  const to = sync?.doc === target.doc ? fromRelativePosition(state, target.to, sync) : null
  if (from !== null && to !== null && to > from &&
      state.doc.textBetween(from, to, '\n') === target.text) {
    // State changes may merge adjacent ranges, but only this bound interval
    // can be reviewed. Mixed state/author or inserted suggestion text invalidates it.
    const range = provenanceRanges(state.doc).find((r) => r.from <= from && r.to >= to)
    if (range && range.attrs.kind === 'ai' && range.attrs.author === target.attrs.author) {
      return { from, to, attrs: range.attrs }
    }
  }
  target.invalid = true
  return null
}

/** Validate the displayed transition against the current exact interval. */
export function applyReviewState(view: EditorView, span: AiSpan, state: ReviewState): boolean {
  const live = provenanceRanges(view.state.doc).find((r) => r.from <= span.from && r.to >= span.to)
  const markType = view.state.schema.marks.provenance
  if (!markType || !live || live.attrs.kind !== 'ai' || !sameAttrs(live.attrs, span.attrs) ||
      nextReviewState(live.attrs.state) !== state) return false
  const tr = view.state.tr
    .removeMark(span.from, span.to, markType)
    .addMark(span.from, span.to, markType.create({ ...live.attrs, state }))
    .setMeta(SKIP_PROVENANCE, true)
  view.dispatch(tr)
  return true
}
