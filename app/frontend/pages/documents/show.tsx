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
import { AnchoredComposer } from '../../components/anchored_composer'
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
import { useAnchoredPopover } from '../../lib/use_anchored_popover'
import { domRange, setHighlight, clearHighlight } from '../../lib/highlights'
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
    seed_author_kind: string | null
    seed_author_name: string | null
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
// Single encode + byte slice; a byte-boundary cut mid-codepoint decodes to
// a trailing U+FFFD that would break prefix matching, so strip it.
const ANCHOR_BYTE_CAP = 10 * 1024
const capAnchor = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= ANCHOR_BYTE_CAP) return text
  return new TextDecoder().decode(bytes.slice(0, ANCHOR_BYTE_CAP)).replace(/�+$/, '')
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
  const popoverOpen =
    Boolean(reviewTarget) ||
    Boolean(selectionTarget) ||
    Boolean(commentTarget) ||
    composerAnchor !== null
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
      // Optimistic placeholders (negative id) have no server row yet — a
      // PATCH against them would 404 (the panel also hides the button).
      if (comment.id < 0) return
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
  // marks whenever the Yjs doc changes. The Yjs 'update' event is the
  // recompute signal — NOT the Milkdown listener, which skips
  // addToHistory:false transactions and therefore never fires for remote
  // collaborators' changes (a passive window would never see new cards).
  // rAF-coalesced so a burst of keystrokes triggers one recompute.
  const [docTick, setDocTick] = useState(0)
  useEffect(() => {
    if (!handle) return
    let raf = 0
    const bump = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setDocTick((tick) => tick + 1)
      })
    }
    handle.ydoc.on('update', bump)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      handle.ydoc.off('update', bump)
    }
  }, [handle])

  const inlineSuggestions = useMemo(() => {
    if (!handle) return []
    try {
      return handle.editor.action((ctx) =>
        collectInlineSuggestions(ctx.get(editorViewCtx).state.doc),
      )
    } catch {
      return []
    }
    // docTick (local + remote Yjs updates) drives the re-derivation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, docTick])

  // ---- Floating chrome placement (measured, selection-centered) ----

  // Mouse-drag gating: selection chrome stays hidden while the primary
  // button is down so the toolbar doesn't chase the cursor mid-drag; it
  // reveals once on release at the settled position. Keyboard selections
  // reveal immediately (no pointer down). Pointerdowns on the chrome itself
  // are exempt so pressing a toolbar button doesn't hide it mid-click.
  const [pointerHeld, setPointerHeld] = useState(false)
  useEffect(() => {
    const onChrome = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('.selection-toolbar, .review-popover, .comment-composer--anchored'))
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || onChrome(event.target)) return
      setPointerHeld(true)
    }
    const up = () => setPointerHeld(false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('blur', up)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', up)
    }
  }, [])

  // One floating form at a time: an open composer suppresses the selection
  // chrome, and so does the share popover (z-60, above the chrome's z-50).
  const [shareOpen, setShareOpen] = useState(false)
  const composerOpen = !isMobile && composerAnchor !== null
  const chromeSuppressed = composerOpen || shareOpen

  const popoverGap = isMobile ? 20 : 8

  const selectionToolbarActive =
    Boolean(selectionTarget) && !pointerHeld && !chromeSuppressed
  const selectionPopover = useAnchoredPopover<HTMLDivElement>({
    active: selectionToolbarActive,
    getView: () => viewRef.current,
    getRange: () => {
      const view = viewRef.current
      if (!view || view.state.selection.empty) return null
      return { from: view.state.selection.from, to: view.state.selection.to }
    },
    gap: popoverGap,
    deps: [selectionTarget, spans, popoverTick],
  })

  const commentAffordanceActive =
    Boolean(commentTarget) && !selectionTarget && !pointerHeld && !chromeSuppressed
  const commentAffordance = useAnchoredPopover<HTMLDivElement>({
    active: commentAffordanceActive,
    getView: () => viewRef.current,
    getRange: () => {
      const view = viewRef.current
      if (!view) return null
      const head = view.state.selection.head
      return { from: head, to: head }
    },
    gap: popoverGap,
    deps: [commentTarget, spans, popoverTick],
  })

  // Re-derive the span from current state: edits shift positions, and
  // advancing the review state changes the attrs the popover renders.
  const liveReviewSpan = useMemo(() => {
    if (!reviewTarget) return null
    const view = viewRef.current
    if (!view) return null
    return aiSpanAt(view.state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewTarget, spans, popoverTick])
  const reviewActive = Boolean(liveReviewSpan) && !pointerHeld && !chromeSuppressed
  const reviewPopover = useAnchoredPopover<HTMLDivElement>({
    active: reviewActive,
    getView: () => viewRef.current,
    getRange: () => {
      const view = viewRef.current
      if (!view) return null
      const span = aiSpanAt(view.state)
      return span ? { from: span.from, to: span.to } : null
    },
    gap: popoverGap,
    deps: [reviewTarget, spans, popoverTick],
  })

  // The composer anchors below the selection's last line and never overlaps
  // the anchored text; if a remote edit removes the anchor it freezes in
  // place (detached) instead of vanishing mid-draft.
  const composerPopover = useAnchoredPopover<HTMLFormElement>({
    active: composerOpen,
    getView: () => viewRef.current,
    getRange: () => {
      const view = viewRef.current
      if (!view || composerAnchor === null) return null
      return findTextRange(view.state.doc, composerAnchor)
    },
    preferBelow: true,
    persistent: true,
    gap: popoverGap,
    deps: [composerAnchor, spans, popoverTick, docTick],
  })

  // Mode switches close the composer without posting (same as Cancel).
  useEffect(() => {
    setComposerAnchor(null)
  }, [mode])

  // The anchored text stays visibly marked while the composer is open —
  // the editor selection itself collapses when focus moves to the textarea.
  useEffect(() => {
    if (!composerOpen || composerAnchor === null) return
    const view = viewRef.current
    if (!view) return
    const range = findTextRange(view.state.doc, composerAnchor)
    const dom = range ? domRange(view, range.from, range.to) : null
    setHighlight('comment-anchor', dom ? [dom] : [])
    return () => clearHighlight('comment-anchor')
    // docTick keeps the highlight tracking edits around the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, composerAnchor, docTick])

  const closeComposer = useCallback(() => {
    setComposerAnchor(null)
    viewRef.current?.focus()
  }, [])

  const submitAnchoredComment = useCallback(
    (body: string) => {
      submitComment(body, composerAnchor)
      viewRef.current?.focus()
    },
    [submitComment, composerAnchor],
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
          </div>
          <div className="doc-header-right">
            {/* ≤4 groups: identity/presence · (mode control) · Share · ⋯ menu */}
            <div className="doc-header-people">
              <IdentityChip identity={identity} guest={guest} onRenamed={handleRenamed} />
              <ProvenanceSummaryChip spans={spans} />
              <PresenceBar humans={peers} agents={presences} compact={isMobile} />
            </div>
            <ModeControl mode={mode} onChange={setMode} locked={modeLocked} />
            <SharePopover agentsActive={presences.length} onOpenChange={setShareOpen} />
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
                seedAuthorKind={doc.seed_author_kind}
                seedAuthorName={doc.seed_author_name}
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
                // The desktop composer is the anchored card next to the
                // selection — the rail keeps the list only.
                composerAnchor={null}
                onSubmit={submitComment}
                onCancelComposer={closeComposer}
                onResolve={resolveComment}
                onJumpTo={jumpToAnchor}
              />
              <ActivityPanel activities={activities} />
            </aside>
          )}
        </main>
        {selectionTarget && selectionToolbarActive && (
          <SelectionToolbar
            rootRef={selectionPopover.ref}
            position={selectionPopover.position}
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
        {commentTarget && commentAffordanceActive && (
          <SelectionToolbar
            rootRef={commentAffordance.ref}
            position={commentAffordance.position}
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
        {liveReviewSpan && reviewActive && (
          <ReviewPopover
            rootRef={reviewPopover.ref}
            span={liveReviewSpan}
            position={reviewPopover.position}
            onAdvance={handleAdvance}
          />
        )}
        {composerOpen && composerAnchor !== null && (
          <AnchoredComposer
            key={composerAnchor}
            rootRef={composerPopover.ref}
            anchor={composerAnchor}
            position={composerPopover.position}
            onSubmit={submitAnchoredComment}
            onCancel={closeComposer}
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
