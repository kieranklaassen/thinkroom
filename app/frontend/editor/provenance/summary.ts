import type { Node } from '@milkdown/kit/prose/model'
import type { ProvenanceAttrs, ProvenanceKind, ReviewState } from './mark'

export interface ProvenanceSpan {
  kind: ProvenanceKind
  author: string
  state: ReviewState
  chars: number
  text: string
}

export interface ProvenanceSummary {
  total: number
  humanPct: number
  aiPct: number
  unreviewedPct: number
}

const SPAN_TEXT_LIMIT = 280

/**
 * Walk the document and collect ordered provenance spans, merging adjacent
 * text runs with identical attribution. Unmarked text counts as human.
 */
export function collectSpans(doc: Node): ProvenanceSpan[] {
  const spans: ProvenanceSpan[] = []

  doc.descendants((node) => {
    if (!node.isText || !node.text) return
    const mark = node.marks.find((m) => m.type.name === 'provenance')
    const attrs: ProvenanceAttrs = mark
      ? (mark.attrs as ProvenanceAttrs)
      : { kind: 'human', author: '', state: 'verbatim' }

    const last = spans[spans.length - 1]
    if (
      last &&
      last.kind === attrs.kind &&
      last.author === attrs.author &&
      last.state === attrs.state
    ) {
      last.chars += node.text.length
      if (last.text.length < SPAN_TEXT_LIMIT) {
        last.text = (last.text + node.text).slice(0, SPAN_TEXT_LIMIT)
      }
    } else {
      spans.push({
        kind: attrs.kind,
        author: attrs.author,
        state: attrs.state,
        chars: node.text.length,
        text: node.text.slice(0, SPAN_TEXT_LIMIT),
      })
    }
  })

  return spans
}

export function summarize(spans: ProvenanceSpan[]): ProvenanceSummary {
  const total = spans.reduce((sum, span) => sum + span.chars, 0)
  if (total === 0) return { total: 0, humanPct: 0, aiPct: 0, unreviewedPct: 0 }

  const human = spans
    .filter((s) => s.kind === 'human')
    .reduce((sum, s) => sum + s.chars, 0)
  const unreviewed = spans
    .filter((s) => s.kind === 'ai' && s.state === 'pending')
    .reduce((sum, s) => sum + s.chars, 0)

  return {
    total,
    humanPct: Math.round((human * 100) / total),
    aiPct: Math.round(((total - human) * 100) / total),
    unreviewedPct: Math.round((unreviewed * 100) / total),
  }
}
