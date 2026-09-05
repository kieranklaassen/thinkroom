import type { MouseEvent } from 'react'
import { summarize, type ProvenanceFilter, type ProvenanceSpan } from '../editor/provenance'

interface Props {
  spans: ProvenanceSpan[]
  ready: boolean
  onNavigate: (filter: ProvenanceFilter, trigger: HTMLButtonElement, keyboard: boolean) => void
}

export function ProvenanceSummaryChip({ spans, ready, onNavigate }: Props) {
  const summary = summarize(spans)
  const activate = (filter: ProvenanceFilter) => (event: MouseEvent<HTMLButtonElement>) =>
    onNavigate(filter, event.currentTarget, event.detail === 0)
  return (
    <span className="prov-summary" role="group" aria-label="Find text by provenance">
      <button type="button" className="prov-summary-part" disabled={!ready}
        aria-label={`Find next human text (${summary.humanPct}%)`} onClick={activate('human')}>
        {summary.humanPct}% human
      </button>
      <span className="prov-summary-sep" aria-hidden="true">·</span>
      <button type="button" className="prov-summary-part" disabled={!ready}
        aria-label={`Find next AI text (${summary.aiPct}%)`} onClick={activate('ai')}>
        {summary.aiPct}% AI
      </button>
      <span className="prov-summary-sep" aria-hidden="true">·</span>
      <button type="button" className="prov-summary-part prov-summary-part--unreviewed" disabled={!ready}
        aria-label={`Find next unreviewed text (${summary.unreviewedPct}%)`} onClick={activate('unreviewed')}>
        {summary.unreviewedPct}% unreviewed
      </button>
    </span>
  )
}
