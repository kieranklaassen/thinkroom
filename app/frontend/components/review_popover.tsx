import { type RefObject } from 'react'
import { REVIEW_ORDER, nextReviewState, type AiSpan, type ReviewState } from '../editor/provenance'

interface Props {
  /** Placement ref from useAnchoredPopover — measured for real-width clamping. */
  rootRef: RefObject<HTMLDivElement | null>
  span: AiSpan
  /** Measured position; null during the pre-measure hidden phase. */
  position: { x: number; y: number } | null
  onAdvance: (state: ReviewState) => void
}

const STATE_LABELS: Record<string, string> = {
  pending: 'Pending review',
  reviewed: 'Reviewed',
  endorsed: 'Endorsed',
}

const ADVANCE_LABELS: Record<string, string> = {
  reviewed: 'Mark reviewed',
  endorsed: 'Endorse',
}

export function ReviewPopover({ rootRef, span, position, onAdvance }: Props) {
  const next = nextReviewState(span.attrs.state)
  const placed = position !== null

  return (
    <div
      ref={rootRef}
      className={`review-popover ${placed ? 'is-placed' : ''}`}
      style={position ? { left: position.x, top: position.y } : undefined}
      inert={!placed}
      // Keep the editor selection alive while interacting.
      onMouseDown={(event) => event.preventDefault()}
      role="toolbar"
      aria-label="Review AI text"
    >
      <span className="review-popover-author">
        {span.attrs.author || 'AI'}
      </span>
      <span className="review-popover-states">
        {REVIEW_ORDER.map((state, index) => (
          <span
            key={state}
            className={`review-popover-dot ${
              REVIEW_ORDER.indexOf(span.attrs.state) >= index ? 'is-active' : ''
            }`}
            title={STATE_LABELS[state]}
          />
        ))}
      </span>
      <span className="review-popover-state">{STATE_LABELS[span.attrs.state]}</span>
      {next && (
        <button className="review-popover-action" onClick={() => onAdvance(next)}>
          {ADVANCE_LABELS[next]}
        </button>
      )}
    </div>
  )
}
