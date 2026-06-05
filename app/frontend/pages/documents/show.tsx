import { useCallback, useMemo, useRef, useState } from 'react'
import { Head } from '@inertiajs/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  DocumentEditor,
  type ConnectionStatus,
  type EditorHandle,
} from '../../editor/milkdown_editor'
import { userIdentity } from '../../editor/identity'
import {
  aiSpanAt,
  applyReviewState,
  type AiSpan,
  type ProvenanceSpan,
  type ReviewState,
} from '../../editor/provenance'
import { ProvenanceSummaryChip } from '../../components/provenance_summary'
import { ReviewPopover } from '../../components/review_popover'

export interface DocumentProps {
  document: {
    id: number
    slug: string
    title: string
    seed_markdown: string | null
    has_state: boolean
  }
  summary: {
    total: number
    human_pct: number
    ai_pct: number
    unreviewed_pct: number
  }
}

interface ReviewTarget {
  span: AiSpan
  position: { x: number; y: number }
}

export default function DocumentShow({ document: doc }: DocumentProps) {
  const identity = useMemo(userIdentity, [])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [, setHandle] = useState<EditorHandle | null>(null)
  const [spans, setSpans] = useState<ProvenanceSpan[]>([])
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  const handleSelection = useCallback((view: EditorView) => {
    viewRef.current = view
    const span = aiSpanAt(view.state)
    if (!span || !view.hasFocus()) {
      setReviewTarget(null)
      return
    }
    const coords = view.coordsAtPos(span.from)
    setReviewTarget({
      span,
      position: { x: coords.left, y: Math.max(8, coords.top - 44) },
    })
  }, [])

  const handleAdvance = useCallback(
    (state: ReviewState) => {
      const view = viewRef.current
      if (!view || !reviewTarget) return
      applyReviewState(view, reviewTarget.span, state)
    },
    [reviewTarget],
  )

  return (
    <>
      <Head title={doc.title} />
      <div className="doc-page">
        <header className="doc-header">
          <div className="doc-header-left">
            <a href="/" className="doc-home" aria-label="Home">
              P.
            </a>
            <span className="doc-title">{doc.title}</span>
            <span
              className={`doc-status doc-status--${status}`}
              title={status === 'live' ? 'Connected — edits sync live' : 'Connecting…'}
            />
          </div>
          <div className="doc-header-right">
            <ProvenanceSummaryChip spans={spans} />
          </div>
        </header>
        <main className="doc-body">
          <article className="doc-main">
            <DocumentEditor
              slug={doc.slug}
              identity={identity}
              onReady={setHandle}
              onStatus={setStatus}
              onSpans={setSpans}
              onSelection={handleSelection}
            />
          </article>
        </main>
        {reviewTarget && (
          <ReviewPopover
            span={reviewTarget.span}
            position={reviewTarget.position}
            onAdvance={handleAdvance}
          />
        )}
      </div>
    </>
  )
}
