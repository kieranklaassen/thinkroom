import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Head, Link, router, usePoll } from '@inertiajs/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  DocumentEditor,
  type ConnectionStatus,
  type EditorHandle,
} from '../../editor/milkdown_editor'
import { userIdentity, type UserIdentity } from '../../editor/identity'
import {
  aiSpanAt,
  applyReviewState,
  type AiSpan,
  type ProvenanceSpan,
  type ReviewState,
} from '../../editor/provenance'
import {
  applySuggestion,
  findTextRange,
  selectedText,
  type SuggestionPayload,
} from '../../editor/suggestions'
import { refreshAgentCursors } from '../../editor/agent_cursors'
import { ProvenanceSummaryChip } from '../../components/provenance_summary'
import { ReviewPopover } from '../../components/review_popover'
import { SuggestionsPanel } from '../../components/suggestions_panel'
import { CommentsPanel, type CommentPayload } from '../../components/comments_panel'
import { SelectionToolbar } from '../../components/selection_toolbar'
import {
  AgentsBadge,
  PresenceBar,
  type AgentPresencePayload,
} from '../../components/presence_bar'
import { ActivityPanel } from '../../components/activity_panel'
import { ThemePicker } from '../../components/theme_picker'
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
  suggestions: SuggestionPayload[]
  comments: CommentPayload[]
  activities: ActivityPayload[]
  presences: AgentPresencePayload[]
}

interface ReviewTarget {
  span: AiSpan
  position: { x: number; y: number }
}

interface SelectionTarget {
  text: string
  position: { x: number; y: number }
}

export default function DocumentShow({
  document: doc,
  suggestions,
  comments,
  activities,
  presences,
}: DocumentProps) {
  const identity = useMemo(userIdentity, [])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [handle, setHandle] = useState<EditorHandle | null>(null)
  const [spans, setSpans] = useState<ProvenanceSpan[]>([])
  const [peers, setPeers] = useState<UserIdentity[]>([])
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const [selectionTarget, setSelectionTarget] = useState<SelectionTarget | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<string | null>(null)
  const [aiPendingCount, setAiPendingCount] = useState(0)
  const aiPending = aiPendingCount > 0
  const prevSuggestionCount = useRef(suggestions.length)
  const [copied, setCopied] = useState(false)
  const viewRef = useRef<EditorView | null>(null)

  useMetaChannel(doc.slug)

  // Only a suggestion ARRIVING clears the thinking state — accept/reject
  // shrink the list and must not re-enable Ask AI while a request is live.
  useEffect(() => {
    if (suggestions.length > prevSuggestionCount.current) {
      setAiPendingCount((count) => Math.max(0, count - 1))
    }
    prevSuggestionCount.current = suggestions.length
  }, [suggestions.length])

  // Human presence from Yjs awareness.
  useEffect(() => {
    if (!handle) return
    const { awareness } = handle.provider
    const update = () => {
      const states = Array.from(awareness.getStates().values())
      setPeers(
        states
          .map((state) => (state as { user?: UserIdentity }).user)
          .filter((user): user is UserIdentity => Boolean(user)),
      )
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [handle])

  // Agent pseudo-cursors track the presences prop.
  useEffect(() => {
    if (!handle) return
    refreshAgentCursors(
      handle.editor,
      presences.map((p) => ({ name: p.agent_name, location: p.location_text })),
    )
  }, [handle, presences])

  // While agents are shown, poll so silent ones expire from the presence bar.
  const presencePoll = usePoll(
    45000,
    { only: ['presences'], async: true },
    { autoStart: false },
  )
  useEffect(() => {
    if (presences.length > 0) presencePoll.start()
    else presencePoll.stop()
  }, [presences.length, presencePoll])

  const handleSelection = useCallback((view: EditorView) => {
    viewRef.current = view
    const { from, to, empty } = view.state.selection

    if (!view.hasFocus()) {
      setReviewTarget(null)
      setSelectionTarget(null)
      return
    }

    if (!empty) {
      const text = view.state.doc.textBetween(from, to, '\n')
      if (text.trim().length > 0) {
        const coords = view.coordsAtPos(from)
        setSelectionTarget({
          text,
          position: { x: coords.left, y: Math.max(8, coords.top - 44) },
        })
        setReviewTarget(null)
        return
      }
    }
    setSelectionTarget(null)

    const span = aiSpanAt(view.state)
    if (!span) {
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
      if (!handle) return
      // The card clears optimistically, but the CRDT insert waits for the
      // server to confirm THIS client won the accept — otherwise two windows
      // accepting concurrently would each insert the text (the loser's PATCH
      // 422s, but a local-first insert could not be rolled back).
      router
        .optimistic((props: Partial<DocumentProps>) => ({
          suggestions: (props.suggestions ?? []).filter((s) => s.id !== suggestion.id),
        }))
        .patch(
          `/suggestions/${suggestion.id}/accept`,
          { by: identity.name },
          {
            preserveScroll: true,
            only: ['suggestions', 'activities'],
            async: true,
            onSuccess: () => {
              applySuggestion(handle.editor, suggestion)
            },
          },
        )
    },
    [handle, identity.name],
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
          { preserveScroll: true, only: ['suggestions', 'activities'], async: true },
        )
    },
    [identity.name],
  )

  const askAi = useCallback(
    (instruction: string, selection?: string) => {
      // One in-flight request at a time — the selection toolbar has no
      // disabled state, so the guard lives here.
      if (aiPendingCount > 0) return
      const context = selection ?? (handle ? selectedText(handle.editor) : '')
      setAiPendingCount((count) => count + 1)
      const release = () => setAiPendingCount((count) => Math.max(0, count - 1))
      void postJSON(`/d/${doc.slug}/ai_suggestions`, {
        instruction,
        context: context || null,
        replaces: context || null,
        anchor_text: context || null,
      })
        .then((response) => {
          // fetch resolves on 4xx/5xx — release the button on server errors.
          if (!response.ok) release()
        })
        .catch(release)
    },
    [doc.slug, handle, aiPendingCount],
  )

  const submitComment = useCallback(
    (body: string, anchorText: string | null) => {
      setComposerAnchor(null)
      const optimisticComment: CommentPayload = {
        id: -Date.now(),
        author_name: identity.name,
        author_kind: 'human',
        body,
        anchor_text: anchorText,
        resolved: false,
        created_at: new Date().toISOString(),
      }
      router
        .optimistic((props: Partial<DocumentProps>) => ({
          comments: [...(props.comments ?? []), optimisticComment],
        }))
        .post(
          `/d/${doc.slug}/comments`,
          { body, anchor_text: anchorText, author_name: identity.name },
          { preserveScroll: true, only: ['comments', 'activities'], async: true },
        )
    },
    [doc.slug, identity.name],
  )

  const resolveComment = useCallback(
    (comment: CommentPayload) => {
      router
        .optimistic((props: Partial<DocumentProps>) => ({
          comments: (props.comments ?? []).map((c) =>
            c.id === comment.id ? { ...c, resolved: true } : c,
          ),
        }))
        .patch(
          `/comments/${comment.id}/resolve`,
          { by: identity.name },
          { preserveScroll: true, only: ['comments', 'activities'], async: true },
        )
    },
    [identity.name],
  )

  const jumpToAnchor = useCallback((anchorText: string) => {
    const view = viewRef.current
    if (!view) return
    const range = findTextRange(view.state.doc, anchorText)
    if (!range) return
    const tr = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, range.from, range.to),
    )
    tr.scrollIntoView()
    view.dispatch(tr)
    view.focus()
  }, [])

  const copyShareLink = useCallback(() => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }, [])

  return (
    <>
      <Head title={doc.title} />
      <div className="doc-page">
        <header className="doc-header">
          <div className="doc-header-left">
            <Link href="/" className="doc-home" aria-label="Home">
              P.
            </Link>
            <span className="doc-title">{doc.title}</span>
            <span
              className={`doc-status doc-status--${status}`}
              title={status === 'live' ? 'Connected — edits sync live' : 'Connecting…'}
            />
            <AgentsBadge agents={presences} />
          </div>
          <div className="doc-header-right">
            <ProvenanceSummaryChip spans={spans} />
            <PresenceBar humans={peers} agents={presences} />
            <ThemePicker />
            <button className="share-button" onClick={copyShareLink}>
              {copied ? 'Copied' : 'Share'}
            </button>
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
          <aside className="doc-rail">
            <SuggestionsPanel
              suggestions={suggestions}
              aiPending={aiPending}
              onAccept={acceptSuggestion}
              onReject={rejectSuggestion}
              onAskAi={(instruction) => askAi(instruction)}
            />
            <CommentsPanel
              comments={comments}
              composerAnchor={composerAnchor}
              onSubmit={submitComment}
              onCancelComposer={() => setComposerAnchor(null)}
              onResolve={resolveComment}
              onJumpTo={jumpToAnchor}
            />
            <ActivityPanel activities={activities} />
          </aside>
        </main>
        {selectionTarget && (
          <SelectionToolbar
            position={selectionTarget.position}
            onComment={() => {
              setComposerAnchor(selectionTarget.text)
              setSelectionTarget(null)
            }}
            onAskAi={() => {
              askAi('', selectionTarget.text)
              setSelectionTarget(null)
            }}
          />
        )}
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
