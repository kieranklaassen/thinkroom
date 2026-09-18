import { useState } from 'react'
import { timeAgo } from '../lib/time'
import { truncate } from '../lib/truncate'
import type { WritingFindingPayload, WritingPassPayload, WritingReviewerPayload, WritingRunStatus } from '../types/payloads'

interface Props {
  reviewers: WritingReviewerPayload[]
  pass: WritingPassPayload | null | undefined
  enabled: boolean
  canWrite: boolean
  off: Set<string>
  onToggle: (key: string) => void
  onRun: () => void
  canRun: boolean
  busy: boolean
  error: string | null
  onDismissError: () => void
  /** Null until the editor measured once; then the ids that still resolve. */
  anchoredIds: Set<number> | null
  changedIds: Set<number>
  onJumpTo: (finding: WritingFindingPayload) => void
  onHover: (finding: WritingFindingPayload | null) => void
  onDismiss: (finding: WritingFindingPayload) => void
}

const RUN_LABELS: Record<WritingRunStatus, string> = {
  queued: 'Queued',
  running: 'Reviewing…',
  finished: 'Done',
  failed: 'Failed',
}

function statusLine(pass: WritingPassPayload | null | undefined, changed: number): string {
  if (pass === undefined) return 'Loading…'
  if (pass === null) return 'Run the reviewers to see their findings in the text.'
  const runs = Object.values(pass.reviewer_runs)
  const done = runs.filter((run) => run.status === 'finished' || run.status === 'failed').length
  if (pass.status === 'queued' || pass.status === 'running') return `Reviewing ${done} of ${runs.length} done…`
  const when = pass.finished_at ? timeAgo(pass.finished_at) : timeAgo(pass.created_at)
  const changedNote = changed > 0 ? ` · ${changed} finding${changed === 1 ? '' : 's'} changed since the last run` : ''
  return `${pass.status === 'failed' ? 'Failed' : 'Finished'} ${when}${changedNote}`
}

/**
 * Compound mode's rail: every reviewer with a switch, its colour, its count
 * and run state, and a Run all button. Toggling a reviewer off both hides
 * its findings and leaves it out of the next run (plan R5). Expanding a
 * reviewer lists its findings for jumping; changed ones cannot jump.
 */
export function CompoundPanel({
  reviewers, pass, enabled, canWrite, off, onToggle, onRun, canRun, busy, error, onDismissError,
  anchoredIds, changedIds, onJumpTo, onHover, onDismiss,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const findings = pass?.findings ?? []
  const byReviewer = new Map<string, WritingFindingPayload[]>()
  for (const finding of findings) {
    const list = byReviewer.get(finding.reviewer_key)
    if (list) list.push(finding)
    else byReviewer.set(finding.reviewer_key, [finding])
  }

  return (
    <section className="rail-section compound-panel" aria-label="Compound writing reviewers">
      <header className="rail-heading compound-heading">
        <h2>Reviewers</h2>
        <button
          type="button"
          className="compound-run"
          onClick={onRun}
          disabled={!canRun || busy}
          title={!enabled ? 'Reviewers are not configured on this server' : !canWrite ? 'Only writers can run reviewers' : 'Run every reviewer that is on'}
        >
          {busy ? 'Running…' : 'Run all'}
        </button>
      </header>
      {!enabled && (
        <p className="compound-notice" role="status">
          Reviewers are not configured on this server. Set <code>TYPESAFE_API_KEY</code> to run them.
        </p>
      )}
      {error && (
        <p className="compound-notice compound-notice--error" role="alert">
          {error}
          <button type="button" className="compound-notice-dismiss" onClick={onDismissError} aria-label="Dismiss">×</button>
        </p>
      )}
      <p className="compound-status" role="status" aria-live="polite">{statusLine(pass, changedIds.size)}</p>
      <ul className="compound-reviewers">
        {reviewers.map((reviewer) => {
          const isOff = off.has(reviewer.key)
          const run = pass?.reviewer_runs[reviewer.key]
          const list = byReviewer.get(reviewer.key) ?? []
          const isExpanded = expanded === reviewer.key
          return (
            <li key={reviewer.key} className={`compound-reviewer ${isOff ? 'is-off' : ''}`} style={{ '--cw-color': `var(--cw-${reviewer.color})` } as React.CSSProperties}>
              <div className="compound-reviewer-row">
                <button
                  type="button"
                  className="compound-reviewer-main"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : reviewer.key)}
                  title={reviewer.blurb}
                >
                  <span className="compound-swatch" aria-hidden="true" />
                  <span className="compound-reviewer-copy">
                    <span className="compound-reviewer-name">{reviewer.name}</span>
                    <span className="compound-reviewer-blurb">{reviewer.blurb}</span>
                  </span>
                  <span className="compound-reviewer-state">
                    {run && run.status !== 'finished' && <span className={`compound-run-state compound-run-state--${run.status}`} title={run.error}>{RUN_LABELS[run.status]}</span>}
                    {!isOff && list.length > 0 && <span className="compound-count">{list.length}</span>}
                  </span>
                </button>
                <label className="compound-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={!isOff}
                    aria-label={`${reviewer.name} reviewer`}
                    onChange={() => onToggle(reviewer.key)}
                  />
                  <span className="compound-switch-track" aria-hidden="true" />
                </label>
              </div>
              {run?.status === 'failed' && run.error && <p className="compound-run-error">{run.error}</p>}
              {isExpanded && (
                <ul className="compound-findings">
                  {list.length === 0 && <li className="compound-empty">{isOff ? 'Off. Switch on to include it in the next run.' : run ? 'No findings.' : 'Not run yet.'}</li>}
                  {list.map((finding) => {
                    const changed = changedIds.has(finding.id)
                    const canJump = finding.scope !== 'text' && anchoredIds?.has(finding.id) && !changed
                    return (
                      <li key={finding.id} className={`compound-finding ${changed ? 'is-changed' : ''}`}
                        onMouseEnter={canJump ? () => onHover(finding) : undefined}
                        onMouseLeave={() => onHover(null)}>
                        <button type="button" className="compound-finding-main" disabled={!canJump} onClick={() => onJumpTo(finding)}
                          title={canJump ? 'Show in document' : changed ? 'Text changed since the run' : finding.note ?? undefined}>
                          <span className="compound-finding-note">{finding.note ?? finding.question_id}</span>
                          <span className="compound-finding-quote">
                            {finding.scope === 'text' ? 'Whole text' : truncate(finding.quote ?? '', 90)}
                          </span>
                          <span className="compound-finding-meta">
                            {changed ? 'Text changed' : `${finding.scope} · ${Math.round(finding.probability * 100)}%`}
                          </span>
                        </button>
                        {canWrite && (
                          <button type="button" className="compound-finding-dismiss" onClick={() => onDismiss(finding)} aria-label="Dismiss finding" title="Dismiss until the next run">×</button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
