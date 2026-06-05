import { summarize, type ProvenanceSpan } from '../editor/provenance'

export function ProvenanceSummaryChip({ spans }: { spans: ProvenanceSpan[] }) {
  const summary = summarize(spans)
  if (summary.total === 0) return null

  return (
    <span className="prov-summary" title="Live provenance breakdown">
      <span className="prov-summary-part">{summary.humanPct}% human</span>
      <span className="prov-summary-sep">·</span>
      <span className="prov-summary-part">{summary.aiPct}% AI</span>
      {summary.unreviewedPct > 0 && (
        <>
          <span className="prov-summary-sep">·</span>
          <span className="prov-summary-part prov-summary-part--unreviewed">
            {summary.unreviewedPct}% unreviewed
          </span>
        </>
      )}
    </span>
  )
}
