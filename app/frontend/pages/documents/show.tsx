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
import { provenanceIdentityCtx } from '../../editor/provenance'
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
  flashMergedRange,
  selectedText,
  type SuggestionPayload,
} from '../../editor/suggestions'
import { refreshAgentCursors } from '../../editor/agent_cursors'
import { editorViewCtx } from '@milkdown/kit/core'
import { collectInlineSuggestions } from '../../editor/suggest_changes'
import {
  MarginInlineSuggestions,
  InlineSuggestionSheetList,
} from '../../components/margin_inline_suggestions'
import { ProvenanceSummaryChip } from '../../components/provenance_summary'
import { ReviewPopover } from '../../components/review_popover'
import { AskAiPanel } from '../../components/suggestions_panel'
import { MarginSuggestions } from '../../components/margin_suggestions'
import { CommentsPanel, type CommentPayload } from '../../components/comments_panel'
import { SelectionToolbar } from '../../components/selection_toolbar'
import { PresenceBar, type AgentPresencePayload } from '../../components/presence_bar'
import { ActivityPanel } from '../../components/activity_panel'
import { IdentityChip } from '../../components/identity_chip'
import { type OwnershipPayload } from '../../components/ownership_chip'
import { ClaimBanner } from '../../components/claim_banner'
import { HeaderMenu } from '../../components/header_menu'
import { ModeControl, type EditorMode } from '../../components/mode_control'
import { SharePopover } from '../../components/share_popover'
import {
  MobileDock,
  MobileSheet,
  SuggestionSheetList,
  type SheetKind,
} from '../../components/mobile_dock'
import { useMetaChannel } from '../../lib/use_meta_channel'
import { useMediaQuery } from '../../lib/use_media_query'
import { postJSON } from '../../lib/csrf'
import {
  getStoredFlag,
  getStoredString,
  setStoredFlag,
  setStoredString,
} from '../../lib/local_storage'

export interface ActivityPayload {
  id: number
  actor_name: string
  actor_kind: string
  action: string
  detail: string | null
  created_at: string
}

export interface ViewerPayload {
  name: string | null
  guest: boolean
}

export interface DocumentProps {
  document: {
    id: number
    slug: string
    title: string
    seed_markdown: string | null
    seed_granted: boolean
    has_state: boolean
    yjs_state_b64: string | null
  }
  viewer: ViewerPayload
  ownership: OwnershipPayload
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

// Click-to-comment (Comment mode): the clicked block's text, anchored at
// the click's collapsed selection — geometry re-derived live like the
// other floating chrome.
interface CommentTarget {
  text: string
}

// Server-side anchor cap is 10 KB; a truncated anchor still matches as a
// prefix within the block (findTextRange matches the exact search string).
const ANCHOR_BYTE_CAP = 10 * 1024
const capAnchor = (text: string): string => {
  if (new TextEncoder().encode(text).length <= ANCHOR_BYTE_CAP) return text
  let sliced = text.slice(0, 10000)
  while (sliced.length > 0 && new TextEncoder().encode(sliced).length > ANCHOR_BYTE_CAP) {
    sliced = sliced.slice(0, sliced.length - 500)
  }
  return sliced
}

// Editor mode persists per doc (Google-Docs semantics: your mode, your
// browser). Client-side only by design — never server state, never shared.
const modeKey = (slug: string) => `pruf:mode:${slug}`

const readStoredMode = (slug: string): EditorMode => {
  const raw = getStoredString(modeKey(slug))
  return raw === 'suggest' || raw === 'comment' ? raw : 'edit'
}

export default function DocumentShow({
  document: doc,
  viewer,
  ownership,
  suggestions,
  comments,
  activities,
  presences,
}: DocumentProps) {
  // Initializer-only state plus an explicit rename handler — NOT a
  // sync-on-prop-change effect, which a future reload batch listing
  // `viewer` would silently clobber mid-rename.
  const [identity, setIdentity] = useState<UserIdentity>(() => userIdentity(viewer.name))
  const [guest, setGuest] = useState(viewer.guest)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [handle, setHandle] = useState<EditorHandle | null>(null)
  const [spans, setSpans] = useState<ProvenanceSpan[]>([])
  const [peers, setPeers] = useState<UserIdentity[]>([])
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const [selectionTarget, setSelectionTarget] = useState<SelectionTarget | null>(null)
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<string | null>(null)
  const [aiPendingCount, setAiPendingCount] = useState(0)
  const aiPending = aiPendingCount > 0
  const prevSuggestionCount = useRef(
    suggestions.filter((s) => s.author_kind !== 'human').length,
  )
  const viewRef = useRef<EditorView | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => getStoredFlag('pruf:panel', true))
  const [focusMode, setFocusMode] = useState(() => getStoredFlag('pruf:focus', false))
  // Demo doc always opens in Edit and stays locked there.
  const modeLocked = doc.slug === 'demo'
  const [mode, setMode] = useState<EditorMode>(() =>
    modeLocked ? 'edit' : readStoredMode(doc.slug),
  )
  // handleSelection is a stable callback — it reads the live mode via ref.
  const modeRef = useRef(mode)
  modeRef.current = mode
  // Leaving Comment mode dismisses any pending click-to-comment affordance.
  useEffect(() => {
    if (mode !== 'comment') setCommentTarget(null)
  }, [mode])

  // ≤64rem: rail and margin cards give way to anchor markers, a bottom dock,
  // and sheets — the full product, rearranged for one hand.
  const isMobile = useMediaQuery('(max-width: 64rem)')
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null)
  const [sheetFocusId, setSheetFocusId] = useState<number | null>(null)
  const suggestionsRef = useRef(suggestions)
  suggestionsRef.current = suggestions
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  useEffect(() => {
    if (!isMobile) setActiveSheet(null)
  }, [isMobile])

  // The comment composer lives in the comments panel — on mobile that means
  // opening its sheet when a selection chooses "Comment".
  useEffect(() => {
    if (isMobile && composerAnchor !== null) setActiveSheet('comments')
  }, [isMobile, composerAnchor])

  useEffect(() => setStoredFlag('pruf:panel', panelOpen), [panelOpen])
  useEffect(() => setStoredFlag('pruf:focus', focusMode), [focusMode])
  useEffect(() => {
    if (!modeLocked) setStoredString(modeKey(doc.slug), mode)
  }, [mode, modeLocked, doc.slug])

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

  // Only a MACHINE suggestion ARRIVING clears the thinking state —
  // accept/reject shrink the list and must not re-enable Ask AI while a
  // request is live, and a human suggestion (yours or a collaborator's)
  // landing mid-request must not release the button early.
  const machineSuggestionCount = suggestions.filter((s) => s.author_kind !== 'human').length
  useEffect(() => {
    if (machineSuggestionCount > prevSuggestionCount.current) {
      setAiPendingCount((count) => Math.max(0, count - 1))
    }
    prevSuggestionCount.current = machineSuggestionCount
  }, [machineSuggestionCount])

  // Human presence from Yjs awareness. Self is filtered out — the
  // IdentityChip represents you; a duplicate avatar next to it is noise.
  useEffect(() => {
    if (!handle) return
    const { awareness } = handle.provider
    const selfId = handle.provider.doc.clientID
    const update = () => {
      const states = Array.from(awareness.getStates().entries())
      setPeers(
        states
          .filter(([clientId]) => clientId !== selfId)
          .map(([, state]) => (state as { user?: UserIdentity }).user)
          .filter((user): user is UserIdentity => Boolean(user)),
      )
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [handle])

  // Rename applies here AFTER the server confirms the session write (the
  // chip's POST onSuccess). The handler only moves React state — the live
  // side effects ride the effect below, so a rename that completes while
  // the editor is still connecting (handle null) heals the moment the
  // handle arrives, and an in-flight POST can never act through a stale
  // null-handle closure.
  const handleRenamed = useCallback((name: string | null) => {
    setIdentity(userIdentity(name))
    setGuest(name === null)
  }, [])

  // Identity state is the source of truth for the live editor surfaces:
  // re-applied whenever the handle arrives or the identity changes.
  // Idempotent — re-writing the same awareness state is a no-op for peers.
  useEffect(() => {
    if (!handle) return
    handle.provider.awareness.setLocalStateField('user', identity)
    handle.editor.action((ctx) => ctx.set(provenanceIdentityCtx.key, { name: identity.name }))
  }, [handle, identity])

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

  // When the doc is deleted (live broadcast, or channel rejection after an
  // offline delete), leave the editor cleanly instead of 404ing in place.
  // Stop the presence poll first — Inertia's navigation is async, and a poll
  // firing in that window would partial-reload the destroyed slug into a 404.
  const onDocumentGone = useCallback(() => {
    presencePoll.stop()
    router.visit('/')
  }, [presencePoll])
  useMetaChannel(doc.slug, { onDeleted: onDocumentGone })

  // The sync channel rejects its resubscription when the doc is gone —
  // same exit path.
  useEffect(() => {
    if (!handle) return
    const provider = handle.provider
    provider.on('rejected', onDocumentGone)
    return () => provider.off('rejected', onDocumentGone)
  }, [handle, onDocumentGone])

  const handleSelection = useCallback((view: EditorView) => {
    viewRef.current = view
    const { from, to, empty } = view.state.selection

    // Only require focus when the view is editable: in Comment mode the
    // root is contenteditable=false, which browsers never focus, so
    // hasFocus() is always false and the focus gate would make the selection
    // toolbar unreachable in the read-only mode.
    if (view.editable && !view.hasFocus()) {
      setReviewTarget(null)
      setSelectionTarget(null)
      return
    }

    if (!empty) {
      const text = view.state.doc.textBetween(from, to, '\n')
      if (text.trim().length > 0) {
        setSelectionTarget({ text })
        setCommentTarget(null)
        setReviewTarget(null)
        return
      }
    }
    setSelectionTarget(null)

    // Mobile: tapping inside a pending suggestion's tinted anchor opens its
    // sheet card — the touch equivalent of glancing at the margin.
    if (isMobileRef.current && empty) {
      const pos = view.state.selection.head
      const hit = suggestionsRef.current.find((s) => {
        const range = findTextRange(view.state.doc, s.replaces ?? s.anchor_text)
        return range !== null && pos >= range.from && pos <= range.to
      })
      if (hit) {
        setSheetFocusId(hit.id)
        setActiveSheet('suggestions')
        setCommentTarget(null)
        setReviewTarget(null)
        return
      }
    }

    // Comment mode: a bare click offers commenting on the clicked block —
    // no drag-selection needed (Google-Docs click-to-comment). Only
    // non-empty textblocks; clicks on empty paragraphs, images, or rules
    // show nothing. Selection-based commenting above keeps working.
    if (modeRef.current === 'comment' && empty) {
      const block = view.state.selection.$head.parent
      const text = block.isTextblock ? block.textContent : ''
      if (text.trim().length > 0) {
        setCommentTarget({ text: capAnchor(text) })
        setReviewTarget(null)
        return
      }
    }
    setCommentTarget(null)

    const span = aiSpanAt(view.state)
    setReviewTarget(span ? { span } : null)
  }, [])

  // While a popover is open, any scroll or resize schedules one rAF-throttled
  // reposition pass (coordsAtPos for a single anchor is cheap).
  const [popoverTick, setPopoverTick] = useState(0)
  const popoverOpen = Boolean(reviewTarget) || Boolean(selectionTarget) || Boolean(commentTarget)
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
  // Prefers above the anchor (clear of the on-screen keyboard on touch),
  // flips below when that would cover the sticky header, and clamps x into
  // the viewport using the popover's estimated width.
  const anchorPosition = useCallback((view: EditorView, pos: number, estWidth = 200) => {
    try {
      const coords = view.coordsAtPos(pos)
      if (coords.top < -24 || coords.top > window.innerHeight + 24) return null
      const offset = isMobileRef.current ? 60 : 44
      const above = coords.top - offset
      const y = above < 52 ? coords.bottom + 8 : above
      const x = Math.max(8, Math.min(coords.left, window.innerWidth - estWidth - 8))
      return { x, y }
    } catch {
      return null
    }
  }, [])

  const liveSelectionPosition = useMemo(() => {
    if (!selectionTarget) return null
    const view = viewRef.current
    if (!view || view.state.selection.empty) return null
    return anchorPosition(view, view.state.selection.from, 190)
    // spans (doc updates) + popoverTick (scroll/resize) drive repositioning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionTarget, spans, popoverTick, anchorPosition])

  const liveCommentPosition = useMemo(() => {
    if (!commentTarget) return null
    const view = viewRef.current
    if (!view) return null
    return anchorPosition(view, view.state.selection.head, 190)
    // spans (doc updates) + popoverTick (scroll/resize) drive repositioning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentTarget, spans, popoverTick, anchorPosition])

  const liveReview = useMemo(() => {
    if (!reviewTarget) return null
    const view = viewRef.current
    if (!view) return null
    // Re-derive the span from current state: edits shift positions, and
    // advancing the review state changes the attrs the popover renders.
    const span = aiSpanAt(view.state)
    if (!span) return null
    const position = anchorPosition(view, span.from, 320)
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
      // Optimistic placeholders (negative id) have no server row yet —
      // a PATCH against them would 404.
      if (suggestion.id < 0) return
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
              const merged = applySuggestion(handle.editor, suggestion)
              // A one-beat pulse on the merged text — the reward for review.
              if (merged) flashMergedRange(handle.editor, merged)
            },
          },
        )
    },
    [handle, identity.name],
  )

  const rejectSuggestion = useCallback(
    (suggestion: SuggestionPayload) => {
      if (suggestion.id < 0) return
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

  // Doc-native tracked edits (Suggest-mode typing), re-derived from the
  // marks whenever the doc changes — spans updates on every doc update, so
  // it doubles as the recompute signal. Every client derives the same list
  // from the synced document; there are no server rows to reload.
  const inlineSuggestions = useMemo(() => {
    if (!handle) return []
    try {
      return handle.editor.action((ctx) =>
        collectInlineSuggestions(ctx.get(editorViewCtx).state.doc),
      )
    } catch {
      return []
    }
  }, [handle, spans])

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
          </div>
          <div className="doc-header-right">
            {/* ≤4 groups: identity/presence · (mode control) · Share · ⋯ menu */}
            <div className="doc-header-people">
              <IdentityChip identity={identity} guest={guest} onRenamed={handleRenamed} />
              <ProvenanceSummaryChip spans={spans} />
              <PresenceBar humans={peers} agents={presences} compact={isMobile} />
            </div>
            <ModeControl mode={mode} onChange={setMode} locked={modeLocked} />
            <SharePopover agentsActive={presences.length} />
            <HeaderMenu
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen((open) => !open)}
              focusMode={focusMode}
              onToggleFocus={() => setFocusMode((focus) => !focus)}
              slug={doc.slug}
              ownership={ownership}
              claimerName={identity.name}
            />
          </div>
        </header>
        <ClaimBanner slug={doc.slug} ownership={ownership} claimerName={identity.name} />
        <main className="doc-body">
          <div className={`doc-canvas ${focusMode ? 'is-focus' : ''}`}>
            <article className="doc-main">
              <DocumentEditor
                slug={doc.slug}
                identity={identity}
                initialStateB64={doc.yjs_state_b64}
                seedMarkdown={doc.seed_markdown}
                seedGranted={doc.seed_granted}
                editable={mode !== 'comment'}
                suggesting={mode === 'suggest'}
                onReady={setHandle}
                onStatus={setStatus}
                onSpans={setSpans}
                onSelection={handleSelection}
              />
            </article>
            <div className="margin-gutter">
              <MarginInlineSuggestions
                inline={inlineSuggestions}
                handle={handle}
                spans={spans}
                focusMode={focusMode || isMobile}
              />
              <MarginSuggestions
                suggestions={suggestions}
                handle={handle}
                spans={spans}
                focusMode={focusMode || isMobile}
                onAccept={acceptSuggestion}
                onReject={rejectSuggestion}
                onMarkerSelect={
                  isMobile
                    ? (suggestion) => {
                        setSheetFocusId(suggestion.id)
                        setActiveSheet('suggestions')
                      }
                    : undefined
                }
              />
            </div>
          </div>
          {!isMobile && (
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
          )}
        </main>
        {selectionTarget && liveSelectionPosition && (
          <SelectionToolbar
            position={liveSelectionPosition}
            actions={[
              // Per-mode capability matrix — Edit: Comment · Ask AI;
              // Suggest: Comment (typing IS the suggestion mechanism);
              // Comment: Comment.
              {
                label: 'Comment',
                onClick: () => {
                  setComposerAnchor(selectionTarget.text)
                  setSelectionTarget(null)
                },
              },
              ...(mode === 'edit'
                ? [
                    {
                      label: 'Ask AI',
                      onClick: () => {
                        askAi('', selectionTarget.text)
                        setSelectionTarget(null)
                      },
                    },
                  ]
                : []),
            ]}
          />
        )}
        {commentTarget && !selectionTarget && liveCommentPosition && (
          <SelectionToolbar
            position={liveCommentPosition}
            actions={[
              {
                label: 'Comment on this paragraph',
                onClick: () => {
                  setComposerAnchor(commentTarget.text)
                  setCommentTarget(null)
                },
              },
            ]}
          />
        )}
        {reviewTarget && liveReview && (
          <ReviewPopover
            span={liveReview.span}
            position={liveReview.position}
            onAdvance={handleAdvance}
          />
        )}
        {isMobile && (
          <MobileDock
            suggestionCount={suggestions.length + inlineSuggestions.length}
            commentCount={comments.filter((c) => !c.resolved).length}
            aiPending={aiPending}
            active={activeSheet}
            onOpen={(kind) => setActiveSheet((current) => (current === kind ? null : kind))}
          />
        )}
        {isMobile && activeSheet === 'suggestions' && (
          <MobileSheet
            title={`Suggestions${suggestions.length + inlineSuggestions.length > 0 ? ` · ${suggestions.length + inlineSuggestions.length}` : ''}`}
            onClose={() => {
              setActiveSheet(null)
              setSheetFocusId(null)
            }}
          >
            <InlineSuggestionSheetList inline={inlineSuggestions} handle={handle} />
            <SuggestionSheetList
              suggestions={suggestions}
              focusId={sheetFocusId}
              onAccept={acceptSuggestion}
              onReject={rejectSuggestion}
            />
          </MobileSheet>
        )}
        {isMobile && activeSheet === 'comments' && (
          <MobileSheet title="Comments" onClose={() => setActiveSheet(null)}>
            <CommentsPanel
              comments={comments}
              composerAnchor={composerAnchor}
              onSubmit={submitComment}
              onCancelComposer={() => setComposerAnchor(null)}
              onResolve={resolveComment}
              onJumpTo={(anchorText) => {
                jumpToAnchor(anchorText)
                setActiveSheet(null)
              }}
            />
          </MobileSheet>
        )}
        {isMobile && activeSheet === 'ask' && (
          <MobileSheet title="Ask AI" onClose={() => setActiveSheet(null)}>
            <AskAiPanel
              aiPending={aiPending}
              onAskAi={(instruction) => {
                askAi(instruction)
                // Close so the dock's badge tells the story when it lands.
                setActiveSheet(null)
              }}
            />
          </MobileSheet>
        )}
        {isMobile && activeSheet === 'activity' && (
          <MobileSheet title="Activity" onClose={() => setActiveSheet(null)}>
            <ActivityPanel activities={activities} />
          </MobileSheet>
        )}
      </div>
    </>
  )
}
