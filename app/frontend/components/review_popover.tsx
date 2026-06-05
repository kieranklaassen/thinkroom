import { REVIEW_ORDER, nextReviewState, type AiSpan, type ReviewState } from '../editor/provenance'

interface Props {
  span: AiSpan
  position: { x: number; y: number }
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

export function ReviewPopover({ span, position, onAdvance }: Props) {
  const next = nextReviewState(span.attrs.state)

  return (
    <div
      className="review-popover"
      style={{ left: position.x, top: position.y }}
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
