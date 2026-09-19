import { useState, type CSSProperties } from 'react'
import { truncate } from '../lib/truncate'
import type { AnchoredParagraph } from '../pages/documents/use_finding_anchors'
import type { WritingFindingPayload, WritingReviewerPayload } from '../types/payloads'

/** What the margin needs to render finding cards alongside comments and
 *  suggestions (MarginAnnotations owns the measured stack). */
export interface FindingCardsSource {
  paragraphs: AnchoredParagraph[]
  /** Lens metadata by reviewer key, from the pass's own snapshot. */
  lenses: Map<string, WritingReviewerPayload>
  canWrite: boolean
  onJumpTo: (finding: WritingFindingPayload) => void
  onHover: (finding: WritingFindingPayload | null) => void
  onDismiss: (finding: WritingFindingPayload) => void
  /** Compact layouts route a marker tap into the reviewers sheet. */
  onMarkerSelect?: (paragraph: AnchoredParagraph) => void
}

/** Rows shown before a card folds the rest behind "Show N more". A live pass
 *  can put a dozen findings on one paragraph; the highlights already show
 *  where they are, so the card stays a summary until asked. */
const VISIBLE_ROWS = 3

export const findingCardKey = (paragraph: AnchoredParagraph) => `finding:${paragraph.pos}`

export const findingCardLabel = (paragraph: AnchoredParagraph) =>
  `${paragraph.findings.length} finding${paragraph.findings.length === 1 ? '' : 's'}`

interface BodyProps {
  paragraph: AnchoredParagraph
  source: FindingCardsSource
}

/**
 * One paragraph's findings as reviewer-coloured rows: hovering spotlights the
 * text, clicking jumps to it, × dismisses for everyone. Folds past three rows.
 */
export function FindingCardBody({ paragraph, source }: BodyProps) {
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? paragraph.findings : paragraph.findings.slice(0, VISIBLE_ROWS)
  const hidden = paragraph.findings.length - rows.length
  return (
    <>
      <ul className="compound-card-list">
        {rows.map((finding) => {
          const lens = source.lenses.get(finding.reviewer_key)
          return (
            <li key={finding.id} className="compound-card-row"
              style={{ '--cw-color': `var(--cw-${lens?.color ?? 0})` } as CSSProperties}
              onMouseEnter={() => source.onHover(finding)}
              onMouseLeave={() => source.onHover(null)}>
              <button type="button" className="compound-card-main" onClick={() => source.onJumpTo(finding)} title="Show in document">
                <span className="compound-swatch" aria-hidden="true" />
                <span className="compound-card-copy">
                  <span className="compound-card-reviewer">{lens?.name ?? finding.reviewer_key.split('/').pop()}</span>
                  <span className="compound-card-note">{finding.note ?? finding.question_id}</span>
                  {finding.scope !== 'paragraph' && <span className="compound-card-quote">{truncate(finding.quote ?? '', 70)}</span>}
                </span>
                <span className="compound-card-probability">{Math.round(finding.probability * 100)}%</span>
              </button>
              {source.canWrite && (
                <button type="button" className="compound-finding-dismiss" onClick={() => source.onDismiss(finding)} aria-label="Dismiss finding" title="Dismiss until the next run">×</button>
              )}
            </li>
          )
        })}
      </ul>
      {(hidden > 0 || expanded) && (
        <button type="button" className="compound-card-more" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </>
  )
}
