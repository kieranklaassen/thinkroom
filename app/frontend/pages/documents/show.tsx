import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Head, router } from '@inertiajs/react'
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
import {
  applySuggestion,
  selectedText,
  type SuggestionPayload,
} from '../../editor/suggestions'
import { ProvenanceSummaryChip } from '../../components/provenance_summary'
import { ReviewPopover } from '../../components/review_popover'
import { SuggestionsPanel } from '../../components/suggestions_panel'
import { useMetaChannel } from '../../lib/use_meta_channel'
import { postJSON } from '../../lib/csrf'

export interface ActivityPayload {
  id: number
  actor_name: string
  actor_kind: string
  action: string
  detail: string | null
  created_at: string
}

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
  suggestions: SuggestionPayload[]
  activities: ActivityPayload[]
}

interface ReviewTarget {
  span: AiSpan
  position: { x: number; y: number }
}

export default function DocumentShow({ document: doc, suggestions }: DocumentProps) {
  const identity = useMemo(userIdentity, [])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [spans, setSpans] = useState<ProvenanceSpan[]>([])
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const [aiPending, setAiPending] = useState(false)
  const handleRef = useRef<EditorHandle | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  useMetaChannel(doc.slug)

  // A new suggestion arriving clears the "thinking" state.
  useEffect(() => {
    setAiPending(false)
  }, [suggestions.length])

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

  const acceptSuggestion = useCallback(
    (suggestion: SuggestionPayload) => {
      const handle = handleRef.current
      if (!handle) return
      // Local-first: the text lands in the CRDT immediately (AI-attributed,
      // pending review); the server reconciles the suggestion status.
      applySuggestion(handle.editor, suggestion)
      router
        .optimistic((props: Partial<DocumentProps>) => ({
          suggestions: (props.suggestions ?? []).filter((s) => s.id !== suggestion.id),
        }))
        .patch(
          `/suggestions/${suggestion.id}/accept`,
          { by: identity.name },
          { preserveScroll: true, only: ['suggestions', 'activities'] },
        )
    },
    [identity.name],
  )

  const rejectSuggestion = useCallback(
    (suggestion: SuggestionPayload) => {
      router
        .optimistic((props: Partial<DocumentProps>) => ({
          suggestions: (props.suggestions ?? []).filter((s) => s.id !== suggestion.id),
        }))
        .patch(
          `/suggestions/${suggestion.id}/reject`,
          { by: identity.name },
          { preserveScroll: true, only: ['suggestions', 'activities'] },
        )
    },
    [identity.name],
  )

  const askAi = useCallback(
    (instruction: string) => {
      const handle = handleRef.current
      const selection = handle ? selectedText(handle.editor) : ''
      setAiPending(true)
      void postJSON(`/d/${doc.slug}/ai_suggestions`, {
        instruction,
        context: selection || null,
        replaces: selection || null,
        anchor_text: selection || null,
      }).catch(() => setAiPending(false))
    },
    [doc.slug],
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
              onReady={(handle) => {
                handleRef.current = handle
              }}
              onStatus={setStatus}
              onSpans={setSpans}
              onSelection={handleSelection}
            />
          </article>
          <aside className="doc-rail">
            <SuggestionsPanel
              suggestions={suggestions}
              aiPending={aiPending}
              onAccept={acceptSuggestion}
              onReject={rejectSuggestion}
              onAskAi={askAi}
            />
          </aside>
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
