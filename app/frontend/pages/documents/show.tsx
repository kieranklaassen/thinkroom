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
import { AskAiPanel } from '../../components/suggestions_panel'
import { MarginSuggestions } from '../../components/margin_suggestions'
import { CommentsPanel, type CommentPayload } from '../../components/comments_panel'
import { SelectionToolbar } from '../../components/selection_toolbar'
import {
  AgentsBadge,
  PresenceBar,
  type AgentPresencePayload,
} from '../../components/presence_bar'
import { ActivityPanel } from '../../components/activity_panel'
import { ThemePicker } from '../../components/theme_picker'
import { SharePopover } from '../../components/share_popover'
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
    yjs_state_b64: string | null
  }
  suggestions: SuggestionPayload[]
  comments: CommentPayload[]
  activities: ActivityPayload[]
  presences: AgentPresencePayload[]
}

// Floating chrome stores only its anchor identity; geometry is re-derived
// from the live editor state on scroll / resize / doc updates, so popovers
// track their text instead of freezing at birth coordinates.
interface ReviewTarget {
  span: AiSpan
}

interface SelectionTarget {
  text: string
}

const readStoredFlag = (key: string, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

const writeStoredFlag = (key: string, value: boolean): void => {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // private mode — the toggle just won't persist
  }
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
  const viewRef = useRef<EditorView | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => readStoredFlag('pruf:panel', true))
  const [focusMode, setFocusMode] = useState(() => readStoredFlag('pruf:focus', false))

  useMetaChannel(doc.slug)

  useEffect(() => writeStoredFlag('pruf:panel', panelOpen), [panelOpen])
  useEffect(() => writeStoredFlag('pruf:focus', focusMode), [focusMode])

  // ⌘\ toggles the side panel, ⌘. toggles suggestion focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.key === '\\') {
        event.preventDefault()
        setPanelOpen((open) => !open)
      } else if (event.key === '.') {
        event.preventDefault()
        setFocusMode((focus) => !focus)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        setSelectionTarget({ text })
        setReviewTarget(null)
        return
      }
    }
    setSelectionTarget(null)

    const span = aiSpanAt(view.state)
    setReviewTarget(span ? { span } : null)
  }, [])

  // While a popover is open, any scroll or resize schedules one rAF-throttled
  // reposition pass (coordsAtPos for a single anchor is cheap).
  const [popoverTick, setPopoverTick] = useState(0)
  const popoverOpen = Boolean(reviewTarget) || Boolean(selectionTarget)
  useEffect(() => {
    if (!popoverOpen) return
    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setPopoverTick((tick) => tick + 1)
      })
    }
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [popoverOpen])

  // Anchor geometry in viewport coords — null while the anchor is off-screen
  // or gone, hiding the popover until the text scrolls back into view.
  const anchorPosition = useCallback((view: EditorView, pos: number) => {
    try {
      const coords = view.coordsAtPos(pos)
      if (coords.top < -24 || coords.top > window.innerHeight + 24) return null
      return { x: coords.left, y: Math.max(8, coords.top - 44) }
    } catch {
      return null
    }
  }, [])

  const liveSelectionPosition = useMemo(() => {
    if (!selectionTarget) return null
    const view = viewRef.current
    if (!view || view.state.selection.empty) return null
    return anchorPosition(view, view.state.selection.from)
    // spans (doc updates) + popoverTick (scroll/resize) drive repositioning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionTarget, spans, popoverTick, anchorPosition])

  const liveReview = useMemo(() => {
    if (!reviewTarget) return null
    const view = viewRef.current
    if (!view) return null
    // Re-derive the span from current state: edits shift positions, and
    // advancing the review state changes the attrs the popover renders.
    const span = aiSpanAt(view.state)
    if (!span) return null
    const position = anchorPosition(view, span.from)
    return position ? { span, position } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewTarget, spans, popoverTick, anchorPosition])

  const handleAdvance = useCallback((state: ReviewState) => {
    const view = viewRef.current
    if (!view) return
    const span = aiSpanAt(view.state)
    if (!span) return
    applyReviewState(view, span, state)
  }, [])

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

  return (
    <>
      <Head title={doc.title} />
      <div className={`doc-page ${panelOpen ? '' : 'is-panel-hidden'}`}>
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
            <button
              className="chrome-toggle"
              aria-pressed={panelOpen}
              title="Hide/show panel — ⌘\"
              onClick={() => setPanelOpen((open) => !open)}
            >
              Panel
            </button>
            <button
              className="chrome-toggle"
              aria-pressed={focusMode}
              title="Suggestion focus — ⌘."
              onClick={() => setFocusMode((focus) => !focus)}
            >
              Focus
            </button>
            <ThemePicker />
            <SharePopover agentsActive={presences.length} />
          </div>
        </header>
        <main className="doc-body">
          <div className={`doc-canvas ${focusMode ? 'is-focus' : ''}`}>
            <article className="doc-main">
              <DocumentEditor
                slug={doc.slug}
                identity={identity}
                initialStateB64={doc.yjs_state_b64}
                onReady={setHandle}
                onStatus={setStatus}
                onSpans={setSpans}
                onSelection={handleSelection}
              />
            </article>
            <div className="margin-gutter">
              <MarginSuggestions
                suggestions={suggestions}
                handle={handle}
                spans={spans}
                focusMode={focusMode}
                onAccept={acceptSuggestion}
                onReject={rejectSuggestion}
              />
            </div>
          </div>
          <aside className="doc-rail">
            <AskAiPanel aiPending={aiPending} onAskAi={(instruction) => askAi(instruction)} />
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
        {selectionTarget && liveSelectionPosition && (
          <SelectionToolbar
            position={liveSelectionPosition}
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
        {reviewTarget && liveReview && (
          <ReviewPopover
            span={liveReview.span}
            position={liveReview.position}
            onAdvance={handleAdvance}
          />
        )}
      </div>
    </>
  )
}
