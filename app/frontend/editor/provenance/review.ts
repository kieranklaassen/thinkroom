import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Mark, MarkType } from '@milkdown/kit/prose/model'
import { REVIEW_ORDER, type ProvenanceAttrs, type ReviewState } from './mark'
import { SKIP_PROVENANCE } from './writer'

export interface AiSpan {
  from: number
  to: number
  attrs: ProvenanceAttrs
}

const sameAttrs = (a: ProvenanceAttrs, b: ProvenanceAttrs): boolean =>
  a.kind === b.kind && a.author === b.author && a.state === b.state

/**
 * The contiguous AI-attributed span under the cursor (or wrapping the
 * selection head), expanded over adjacent text nodes with identical attrs.
 */
export function aiSpanAt(state: EditorState): AiSpan | null {
  const markType = state.schema.marks.provenance as MarkType | undefined
  if (!markType) return null

  const { $head, empty } = state.selection
  const marks = empty ? $head.marks() : state.doc.resolve($head.pos).marks()
  const mark = marks.find((m: Mark) => m.type === markType && m.attrs.kind === 'ai')
  if (!mark) return null

  const attrs = mark.attrs as ProvenanceAttrs
  let from = $head.pos
  let to = $head.pos

  state.doc.nodesBetween(
    Math.max(0, $head.start() - 1),
    Math.min(state.doc.content.size, $head.end() + 1),
    (node, pos) => {
      if (!node.isText) return
      const nodeMark = markType.isInSet(node.marks)
      if (!nodeMark || !sameAttrs(nodeMark.attrs as ProvenanceAttrs, attrs)) return
      const nodeFrom = pos
      const nodeTo = pos + node.nodeSize
      if (nodeTo >= $head.pos && nodeFrom <= $head.pos) {
        // The run containing the cursor — extend over contiguous siblings.
        from = Math.min(from, nodeFrom)
        to = Math.max(to, nodeTo)
      } else if (nodeFrom === to) {
        to = nodeTo
      } else if (nodeTo === from) {
        from = nodeFrom
      }
    },
  )

  if (to <= from) return null
  return { from, to, attrs }
}

export function nextReviewState(current: ReviewState): ReviewState | null {
  const index = REVIEW_ORDER.indexOf(current)
  if (index === -1 || index === REVIEW_ORDER.length - 1) return null
  return REVIEW_ORDER[index + 1]
}

/** Re-apply the provenance mark across the span with an advanced state. */
export function applyReviewState(
  view: EditorView,
  span: AiSpan,
  state: ReviewState,
): void {
  const markType = view.state.schema.marks.provenance as MarkType
  const tr = view.state.tr
    .removeMark(span.from, span.to, markType)
    .addMark(span.from, span.to, markType.create({ ...span.attrs, state }))
  tr.setMeta(SKIP_PROVENANCE, true)
  view.dispatch(tr)
}
