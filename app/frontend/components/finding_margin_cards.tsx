import { useRef } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorHandle } from '../editor/milkdown_editor'
import { useMarginStack } from '../lib/use_margin_stack'
import { truncate } from '../lib/truncate'
import type { AnchoredParagraph } from '../pages/documents/use_finding_anchors'
import type { WritingFindingPayload, WritingReviewerPayload } from '../types/payloads'

interface Props {
  paragraphs: AnchoredParagraph[]
  reviewers: WritingReviewerPayload[]
  handle: EditorHandle | null
  /** Markers instead of cards: focus mode and compact layouts. */
  compact: boolean
  canWrite: boolean
  onJumpTo: (finding: WritingFindingPayload) => void
  onHover: (finding: WritingFindingPayload | null) => void
  onDismiss: (finding: WritingFindingPayload) => void
  /** Compact layouts route a marker tap into the reviewers sheet. */
  onMarkerSelect?: (paragraph: AnchoredParagraph) => void
}

/**
 * One card per paragraph with findings, in the document's right margin at
 * the paragraph's vertical position (same measured stack as comments and
 * suggestions, so cards never overlap). Each row is one finding in its
 * reviewer's colour; hovering spotlights the text, clicking jumps to it.
 */
export function FindingMarginCards({ paragraphs, reviewers, handle, compact, canWrite, onJumpTo, onHover, onDismiss, onMarkerSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const byKey = new Map(reviewers.map((reviewer) => [reviewer.key, reviewer]))

  let layoutElement: HTMLElement | null = null
  try { layoutElement = handle?.editor.action((ctx) => ctx.get(editorViewCtx).dom) ?? null } catch { /* editor unmount */ }
  const { tops, placed, setCardRef, height } = useMarginStack<number>(() => {
    const container = containerRef.current
    if (!container || !handle) return null
    let view: EditorView
    try {
      view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
    } catch {
      return null // editor torn down mid-navigation
    }
    const containerTop = container.getBoundingClientRect().top
    const max = view.state.doc.content.size
    return paragraphs.map((paragraph) => {
      let top: number
      try {
        top = view.coordsAtPos(Math.min(paragraph.pos + 1, max)).top - containerTop
      } catch {
        top = 0 // remeasured on the next change
      }
      return { key: paragraph.pos, top: Math.max(0, top) }
    })
  }, [paragraphs, handle, compact], layoutElement)

  return (
    <div className="margin-annotations compound-margin" style={{ minHeight: height }} ref={containerRef} aria-label="Writing findings">
      {paragraphs.map((paragraph) => {
        const key = paragraph.pos
        const label = `${paragraph.findings.length} finding${paragraph.findings.length === 1 ? '' : 's'}`
        if (compact) {
          return (
            <button key={key} ref={setCardRef(key)}
              className={`margin-marker margin-marker--finding ${placed.has(key) ? 'is-placed' : ''}`}
              style={{ top: tops.get(key) ?? 0 }}
              aria-label={label}
              title={label}
              onClick={() => (onMarkerSelect ? onMarkerSelect(paragraph) : onJumpTo(paragraph.findings[0]))} />
          )
        }
        return (
          <article key={key} ref={setCardRef(key)} className={`compound-card ${placed.has(key) ? 'is-placed' : ''}`}
            style={{ top: tops.get(key) ?? 0 }} aria-label={label}>
            <ul className="compound-card-list">
              {paragraph.findings.map((finding) => {
                const reviewer = byKey.get(finding.reviewer_key)
                return (
                  <li key={finding.id} className="compound-card-row"
                    style={{ '--cw-color': `var(--cw-${reviewer?.color ?? 0})` } as React.CSSProperties}
                    onMouseEnter={() => onHover(finding)}
                    onMouseLeave={() => onHover(null)}>
                    <button type="button" className="compound-card-main" onClick={() => onJumpTo(finding)} title="Show in document">
                      <span className="compound-swatch" aria-hidden="true" />
                      <span className="compound-card-copy">
                        <span className="compound-card-reviewer">{reviewer?.name ?? finding.reviewer_key}</span>
                        <span className="compound-card-note">{finding.note ?? finding.question_id}</span>
                        {finding.scope !== 'paragraph' && <span className="compound-card-quote">{truncate(finding.quote ?? '', 70)}</span>}
                      </span>
                      <span className="compound-card-probability">{Math.round(finding.probability * 100)}%</span>
                    </button>
                    {canWrite && (
                      <button type="button" className="compound-finding-dismiss" onClick={() => onDismiss(finding)} aria-label="Dismiss finding" title="Dismiss until the next run">×</button>
                    )}
                  </li>
                )
              })}
            </ul>
          </article>
        )
      })}
    </div>
  )
}
