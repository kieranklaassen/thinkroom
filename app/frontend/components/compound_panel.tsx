import { useState, type CSSProperties, type FormEvent } from 'react'
import { timeAgo } from '../lib/time'
import { truncate } from '../lib/truncate'
import type {
  WritingFindingPayload,
  WritingPackPayload,
  WritingPassPayload,
  WritingReviewerPayload,
  WritingRunStatus,
} from '../types/payloads'

export interface CompoundPanelProps {
  /** The account's enabled lenses across its packs. */
  reviewers: WritingReviewerPayload[]
  packs: WritingPackPayload[]
  pass: WritingPassPayload | null | undefined
  enabled: boolean
  canWrite: boolean
  onToggleLens: (packId: number, key: string) => void
  onAddPack: (locator: string) => void
  onRemovePack: (packId: number) => void
  packBusy: boolean
  packError: string | null
  onDismissPackError: () => void
  onRun: () => void
  canRun: boolean
  /** The run request is in flight (a judging pass never blocks a new run). */
  requesting: boolean
  /** The live text no longer matches what the pass judged. */
  textChanged: boolean
  error: string | null
  notice: string | null
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

const ORIGIN_LABELS: Record<WritingReviewerPayload['origin'], string> = {
  sidecar: 'pack-defined questions',
  curated: 'Thinkroom-curated questions',
  generated: 'questions generated from the skill description',
}

function statusLine(pass: WritingPassPayload | null | undefined, changed: number, textChanged: boolean): string {
  if (pass === undefined) return 'Loading…'
  if (pass === null) return 'Run the reviewers to see their findings in the text.'
  const runs = Object.values(pass.reviewer_runs)
  const done = runs.filter((run) => run.status === 'finished' || run.status === 'failed').length
  if (pass.status === 'queued' || pass.status === 'running') return `Reviewing, ${done} of ${runs.length} done…`
  const when = pass.finished_at ? timeAgo(pass.finished_at) : timeAgo(pass.created_at)
  const notes: string[] = []
  if (textChanged) notes.push('text changed since the last run')
  if (changed > 0) notes.push(`${changed} finding${changed === 1 ? '' : 's'} changed`)
  return `${pass.status === 'failed' ? 'Failed' : 'Finished'} ${when}${notes.length ? ` · ${notes.join(', ')}` : ''}`
}

/**
 * Comment mode's reviewers rail for featured accounts: every pack the account
 * subscribed to, each lens with a switch, its colour, count, and run state,
 * plus Run all and an Add pack form. Switching a lens off hides its findings
 * and leaves it out of the next run; the choice lives on the account.
 * Expanding a lens lists its findings for jumping; changed ones cannot jump.
 */
export function CompoundPanel({
  reviewers, packs, pass, enabled, canWrite, onToggleLens, onAddPack, onRemovePack, packBusy, packError, onDismissPackError,
  onRun, canRun, requesting, textChanged, error, notice, onDismissError, anchoredIds, changedIds, onJumpTo, onHover, onDismiss,
}: CompoundPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [locator, setLocator] = useState('')
  const [addingPack, setAddingPack] = useState(false)
  const findings = pass?.findings ?? []
  const byReviewer = new Map<string, WritingFindingPayload[]>()
  for (const finding of findings) {
    const list = byReviewer.get(finding.reviewer_key)
    if (list) list.push(finding)
    else byReviewer.set(finding.reviewer_key, [finding])
  }
  // Findings carry the lens they were judged with; the pass snapshot names them.
  const snapshotLens = new Map((pass?.lenses ?? []).map((lens) => [lens.key, lens]))
  const enabledCount = reviewers.length

  const submitPack = (event: FormEvent) => {
    event.preventDefault()
    onAddPack(locator)
    setLocator('')
  }

  return (
    <section className="rail-section compound-panel" aria-label="Writing reviewers">
      <header className="rail-heading compound-heading">
        <h2>Reviewers</h2>
        <button
          type="button"
          className="compound-run"
          onClick={onRun}
          disabled={!canRun || enabledCount === 0}
          title={!enabled ? 'Reviewers are not configured on this server' : !canWrite ? 'Only writers can run reviewers' : enabledCount === 0 ? 'Switch on at least one reviewer' : 'Run every reviewer that is on; a new run replaces the last one'}
        >
          {requesting ? 'Starting…' : pass ? 'Run again' : 'Run all'}
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
      {notice && !error && (
        <p className="compound-notice" role="status">
          {notice}
          <button type="button" className="compound-notice-dismiss" onClick={onDismissError} aria-label="Dismiss">×</button>
        </p>
      )}
      <p className="compound-status" role="status" aria-live="polite">{statusLine(pass, changedIds.size, textChanged)}</p>

      {packs.length === 0 && (
        <p className="compound-empty">No packs yet. Add a marketplace below, for example <code>EveryInc/compound-writing</code>.</p>
      )}
      {packs.map((pack) => (
        <section key={pack.id} className="compound-pack" aria-label={`Pack ${pack.display_name}`}>
          <header className="compound-pack-heading">
            <span className="compound-pack-copy">
              <span className="compound-pack-name">{pack.display_name}</span>
              <span className="compound-pack-meta" title={`${pack.source_locator} at ${pack.source_sha}${pack.fetched_at ? `, fetched ${timeAgo(pack.fetched_at)}` : ''}`}>
                {pack.source_locator}{pack.version ? ` · ${pack.version}` : ''} · {pack.short_sha}
              </span>
            </span>
            <button type="button" className="compound-pack-remove" onClick={() => onRemovePack(pack.id)} disabled={packBusy} aria-label={`Remove ${pack.display_name}`} title="Remove this pack from your account">
              Remove
            </button>
          </header>
          <ul className="compound-reviewers">
            {pack.lenses.map((lens) => {
              const isOff = !lens.enabled
              const run = pass?.reviewer_runs[lens.key]
              const list = byReviewer.get(lens.key) ?? []
              const isExpanded = expanded === lens.key
              return (
                <li key={lens.key} className={`compound-reviewer ${isOff ? 'is-off' : ''}`} style={{ '--cw-color': `var(--cw-${lens.color})` } as CSSProperties}>
                  <div className="compound-reviewer-row">
                    <button
                      type="button"
                      className="compound-reviewer-main"
                      aria-expanded={isExpanded}
                      onClick={() => setExpanded(isExpanded ? null : lens.key)}
                      title={`${lens.blurb} (${ORIGIN_LABELS[lens.origin]})`}
                    >
                      <span className="compound-swatch" aria-hidden="true" />
                      <span className="compound-reviewer-copy">
                        <span className="compound-reviewer-name">{lens.name}</span>
                        <span className="compound-reviewer-blurb">{lens.blurb}</span>
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
                        disabled={packBusy}
                        aria-label={`${lens.name} reviewer`}
                        onChange={() => onToggleLens(pack.id, lens.key)}
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
                        const note = finding.note ?? snapshotLens.get(finding.reviewer_key)?.questions.find((question) => question.id === finding.question_id)?.note ?? finding.question_id
                        return (
                          <li key={finding.id} className={`compound-finding ${changed ? 'is-changed' : ''}`}
                            onMouseEnter={canJump ? () => onHover(finding) : undefined}
                            onMouseLeave={() => onHover(null)}>
                            <button type="button" className="compound-finding-main" disabled={!canJump} onClick={() => onJumpTo(finding)}
                              title={canJump ? 'Show in document' : changed ? 'Text changed since the run' : note}>
                              <span className="compound-finding-note">{note}</span>
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
      ))}

      <footer className="compound-packs-footer">
        {packError && (
          <p className="compound-notice compound-notice--error" role="alert">
            {packError}
            <button type="button" className="compound-notice-dismiss" onClick={onDismissPackError} aria-label="Dismiss">×</button>
          </p>
        )}
        {addingPack ? (
          <form className="compound-add-pack" onSubmit={submitPack}>
            <input
              className="compound-add-pack-input"
              type="text"
              value={locator}
              placeholder="owner/repo or owner/repo@ref"
              aria-label="Marketplace to add"
              autoFocus
              disabled={packBusy}
              onChange={(event) => setLocator(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setAddingPack(false)
                  setLocator('')
                }
              }}
            />
            <button type="submit" className="compound-add-pack-submit" disabled={packBusy || locator.trim() === ''}>
              {packBusy ? 'Adding…' : 'Add'}
            </button>
          </form>
        ) : (
          <button type="button" className="compound-add-pack-toggle" onClick={() => setAddingPack(true)} disabled={packBusy}>
            Add pack
          </button>
        )}
        <p className="compound-packs-help">
          A pack is a Claude Code plugin marketplace (<code>.claude-plugin/marketplace.json</code>, <code>skills/*/SKILL.md</code>); each skill becomes a reviewer.
        </p>
      </footer>
    </section>
  )
}
