import { useEffect, useRef, type RefObject } from 'react'
import { nextReviewState, type AiSpan, type ReviewState } from '../editor/provenance'

interface Props {
  rootRef: RefObject<HTMLDivElement | null>
  span: AiSpan
  position: { x: number; y: number } | null
  onAdvance: (state: ReviewState) => void
  canReview: boolean
  focusRequest: object | null
  onClose: () => void
}

const STATES: Record<ReviewState, { label: string; explanation: string }> = {
  pending: { label: 'Unreviewed', explanation: 'Read this passage, then mark it reviewed.' },
  reviewed: { label: 'Reviewed', explanation: 'A human has reviewed this. Endorse it when you stand behind these words.' },
  endorsed: { label: 'Endorsed', explanation: 'A human stands behind these words. You’re done here.' },
  verbatim: { label: 'AI text', explanation: 'This passage records AI authorship without a review state.' },
}

export function ReviewPopover({ rootRef, span, position, onAdvance, canReview, focusRequest, onClose }: Props) {
  const next = nextReviewState(span.attrs.state)
  const state = STATES[span.attrs.state] ?? STATES.verbatim
  const placed = position !== null
  const action = useRef<HTMLButtonElement | null>(null)
  const focused = useRef<object | null>(null)
  useEffect(() => {
    if (!placed || !focusRequest || focused.current === focusRequest) return
    focused.current = focusRequest
    action.current?.focus({ preventScroll: true })
  }, [placed, focusRequest])

  return (
    <div ref={rootRef} className={`review-popover ${placed ? 'is-placed' : ''}`}
      style={position ? { left: position.x, top: position.y } : undefined}
      inert={!placed} onMouseDown={(event) => event.preventDefault()}
      role="dialog" aria-label="Review AI text" aria-describedby="review-explanation">
      <div className="review-popover-heading">
        <span className="review-popover-author">{span.attrs.author || 'AI'} <span>· AI</span></span>
        <span className={`review-popover-state review-popover-state--${span.attrs.state}`}>{state.label}</span>
      </div>
      <p id="review-explanation" className="review-popover-explanation" aria-live="polite">
        {state.explanation}
        {!canReview && next && <span className="review-popover-permission">Review actions are available in Edit mode with write access.</span>}
      </p>
      <div className="review-popover-actions">
        <button ref={action} type="button" className="review-popover-action"
          onClick={() => next && canReview ? onAdvance(next) : onClose()}>
          {next && canReview ? (next === 'reviewed' ? 'Mark reviewed' : 'Endorse') : 'Done'}
        </button>
        {next && canReview && <button type="button" className="review-popover-close" onClick={onClose}>Close</button>}
      </div>
    </div>
  )
}
