import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Head, Link, router, usePoll } from '@inertiajs/react'
import { nativeHaptic } from '@ruby-native/react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { ConnectionStatus, EditorHandle } from '../../editor/milkdown_editor'
import type { DocumentFormat } from '../../editor/document_format'
import { provenanceIdentityCtx } from '../../editor/provenance'
import {
  aiSpanAt,
  applyReviewState,
  type ProvenanceSpan,
  type ReviewState,
} from '../../editor/provenance'
import { refreshAgentCursors } from '../../editor/agent_cursors'
import {
  HIGHLIGHT_COLORS,
  applyHighlight,
  collectHighlights,
  removeHighlight,
  selectionHighlightColor,
  type HighlightGroup,
  type HighlightSnippet,
} from '../../editor/text_highlighter'
import type { RenderHints } from '../../editor/cable_provider'
import { bindReadModeCopy } from '../../editor/clipboard'
import { bindReadPointerBroadcast } from '../../editor/read_pointers'
import {
  downloadDocumentHtml,
  downloadDocumentMarkdown,
  printDocument,
} from '../../editor/document_export'
import { ProvenanceSummaryChip } from '../../components/provenance_summary'
import { HighlightLegendPanel } from '../../components/highlight_legend_panel'
import { ReviewPopover } from '../../components/review_popover'
import { MarginSuggestions } from '../../components/margin_suggestions'
import { CommentsPanel } from '../../components/comments_panel'
import { AnchoredComposer } from '../../components/anchored_composer'
import { SelectionToolbar } from '../../components/selection_toolbar'
import { PresenceBar } from '../../components/presence_bar'
import { ActivityPanel } from '../../components/activity_panel'
import { IdentityChip } from '../../components/identity_chip'
import { ClaimBanner } from '../../components/claim_banner'
import { HeaderMenu } from '../../components/header_menu'
import { DocumentWidthHandle } from '../../components/document_width_handle'
import {
  MODE_SHORTCUTS,
  ModeControl,
  type EditorMode,
} from '../../components/mode_control'
import { SharePopover } from '../../components/share_popover'
import {
  MobileDock,
  MobileSheet,
  SuggestionSheetList,
  type SheetKind,
} from '../../components/mobile_dock'
import { useSuggestionReview } from './use_suggestion_review'
import { useDocumentIdentity } from './use_document_identity'
import { useFollowPresence } from './use_follow_presence'
import { useComments } from './use_comments'
import { useFloatingChrome, type TextTarget } from './use_floating_chrome'
import { NativeDocBridge } from './native_doc_bridge'
import { StagedDocumentEditor } from './staged_document_editor'
import type { ReviewableSuggestion } from '../../components/suggestion_card'
import { useMetaChannel } from '../../lib/use_meta_channel'
import { useMediaQuery } from '../../lib/use_media_query'
import { useIsClient } from '../../lib/use_is_client'
import type { SharedProps } from '../../types'
import type { ViewerPayload } from '../../types/viewer'
import type {
  ActivityPayload,
  AgentPresencePayload,
  CollaboratorKind,
  CommentPayload,
  OwnershipPayload,
  SuggestionPayload,
} from '../../types/payloads'
import { setCookie, setCookieFlag } from '../../lib/cookies'
import {
  RICH_BLOCK_WIDTH_EVENT,
  type RichBlockWidthEventDetail,
} from '../../editor/rich_block_width'
import './show.css'

export interface DocumentProps {
  document: {
    id: number
    slug: string
    title: string
    content_format: DocumentFormat
    seed_content: string | null
    seed_version: string
    seed_granted: boolean
    seed_author_kind: CollaboratorKind | null
    seed_author_name: string | null
    has_state: boolean
    yjs_state_b64: string | null
    content_html: string
    display_title: string
    // Persisted render geometry (Mermaid figure heights by source hash):
    // the server sized the content_html skeletons from these, and the editor
    // pre-sizes its own figures from the same values, so async diagram
    // rendering never shifts the page.
    render_hints: RenderHints
  }
  viewer: ViewerPayload
  // Server-rendered UI prefs from cookies — the source of truth for first
  // paint so SSR and the client's first render agree (no post-hydration flip).
  ui: {
    panel_open: boolean
    focus_mode: boolean
    mode: EditorMode
    document_width: number | null
    rich_content_width: number | null
  }
  ownership: OwnershipPayload
  suggestions: SuggestionPayload[]
  comments: CommentPayload[]
  activities: ActivityPayload[]
  presences: AgentPresencePayload[]
  /** Persisted highlighter legend names ({ yellow: 'Urgent' }). */
  highlight_names: Record<string, string>
  nativeApp: SharedProps['nativeApp']
}

const documentModePath = (slug: string, mode: EditorMode) =>
  `/d/${encodeURIComponent(slug)}${mode === 'read' ? '' : `/${mode}`}`

const availableDocumentModes = (canWrite: boolean, canComment: boolean): EditorMode[] => {
  if (canWrite) return ['edit', 'suggest', 'comment', 'read']
  if (canComment) return ['comment', 'read']
  return ['read']
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

export default function DocumentShow({
  document: doc,
  viewer,
  ui,
  ownership,
  suggestions,
  comments,
  activities,
  presences,
  highlight_names: highlightNames,
  nativeApp,
}: DocumentProps) {
  // SSR/hydration island flag: the live editor and any render-time browser
  // reads are gated on this so the server (and the client's first hydration
  // render) produce identical markup. It flips true on the next client commit.
  const isClient = useIsClient()

  const { identity, guest, handleRenamed } = useDocumentIdentity(viewer)
  // Optimistic: a hydrated or freshly-seeded doc is functionally live the
  // moment it paints — the websocket only confirms it. Starting at 'live'
  // avoids the connecting→live dot flash on every load.
  const [status, setStatus] = useState<ConnectionStatus>(
    doc.has_state || doc.seed_granted ? 'live' : 'connecting',
  )
  // Server-derived first-H1 title so the header reads correctly on first paint;
  // the editor keeps it live via onTitleChange once it mounts.
  const [documentTitle, setDocumentTitle] = useState(doc.display_title || doc.title)
  const [newVersionAvailable, setNewVersionAvailable] = useState(false)
  // The staged (image-settled) editor handle, reported by StagedDocumentEditor.
  const [handle, setHandle] = useState<EditorHandle | null>(null)
  const [spans, setSpans] = useState<ProvenanceSpan[]>([])
  // Whichever text-anchored floating affordance is open (selection toolbar,
  // click-to-comment, AI review) — one cell, structurally mutually exclusive.
  const [textTarget, setTextTarget] = useState<TextTarget | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Hydration-safe init from server-rendered prefs: cookies supply panel/focus/
  // width while the URL supplies mode, so SSR and the first client render agree.
  const [panelOpen, setPanelOpen] = useState(ui.panel_open)
  const [focusMode, setFocusMode] = useState(ui.focus_mode)
  const [documentWidth, setDocumentWidth] = useState<number | null>(ui.document_width)
  const [richContentWidth, setRichContentWidth] = useState<number | null>(ui.rich_content_width)

  useEffect(() => {
    const handleRichBlockWidth = (event: Event) => {
      const detail = (event as CustomEvent<RichBlockWidthEventDetail>).detail
      setRichContentWidth(detail.width)
      if (detail.commit) setCookie('pruf_rich_width', detail.width === null ? 'default' : String(detail.width))
    }
    window.addEventListener(RICH_BLOCK_WIDTH_EVENT, handleRichBlockWidth)
    return () => window.removeEventListener(RICH_BLOCK_WIDTH_EVENT, handleRichBlockWidth)
  }, [])
  // Demo doc always opens in Edit and stays locked there. Ordinary documents
  // take mode directly from the Inertia page props/history entry.
  const demoModeLocked = doc.slug === 'demo'
  const mode = demoModeLocked ? 'edit' : ui.mode
  const availableModes = useMemo(
    () => availableDocumentModes(ownership.can_write, ownership.can_comment),
    [ownership.can_comment, ownership.can_write],
  )
  const modeAvailable = availableModes.includes(mode)
  const effectiveMode: EditorMode = modeAvailable ? mode : 'read'
  const modeLocked = demoModeLocked || availableModes.length === 1
  const changeMode = useCallback((nextMode: EditorMode) => {
    if (modeLocked || !availableModes.includes(nextMode) || nextMode === mode) return

    // This is an Inertia client-side visit: it pushes URL + props into Inertia
    // history without fetching or remounting the collaborative editor. Native
    // Back/Forward restores the matching ui.mode from that history entry.
    router.push<DocumentProps>({
      url: documentModePath(doc.slug, nextMode),
      props: (props) => ({
        ...props,
        ui: { ...props.ui, mode: nextMode },
      }),
      preserveState: true,
      preserveScroll: true,
    })
  }, [availableModes, doc.slug, mode, modeLocked])
  const isReading = effectiveMode === 'read'
  const connectionIdentity = viewer.account ? `account:${viewer.account.id}` : 'guest'
  const editorSessionKey = `${doc.slug}:${ownership.can_write ? 'write' : 'read'}`
  // Live handle for code that runs after awaits or inside stable callbacks —
  // a closure-captured handle goes stale when the editor remounts mid-flight.
  const handleRef = useRef<EditorHandle | null>(null)
  handleRef.current = handle

  // Review-surface recompute signal, re-derived whenever the Yjs doc
  // changes. The Yjs 'update' event is the signal — NOT the Milkdown
  // listener, which skips addToHistory:false transactions and therefore
  // never fires for remote collaborators' changes (a passive window would
  // never see new cards). rAF-coalesced so a burst of keystrokes triggers
  // one recompute.
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

  const {
    items: reviewItems,
    pendingSuggestionCount,
    acceptAllSuggestions,
    acceptingAll,
    suggestionNotice,
    setSuggestionNotice,
  } = useSuggestionReview({
    handle,
    handleRef,
    suggestions,
    slug: doc.slug,
    contentFormat: doc.content_format,
    identityName: identity.name,
    docTick,
  })
  const reviewItemsRef = useRef(reviewItems)
  reviewItemsRef.current = reviewItems

  const exportMarkdown = useCallback(async () => {
    const live = handleRef.current
    if (!live) throw new Error('Document editor is not ready')
    await downloadDocumentMarkdown(live.editor, documentTitle)
  }, [documentTitle])
  const exportHtml = useCallback(async () => {
    const live = handleRef.current
    if (!live) throw new Error('Document editor is not ready')
    await downloadDocumentHtml(live.editor, documentTitle)
  }, [documentTitle])
  // handleSelection is a stable callback — it reads the live mode via ref.
  const modeRef = useRef(effectiveMode)
  modeRef.current = effectiveMode
  // Leaving Comment mode dismisses any pending click-to-comment affordance.
  useEffect(() => {
    if (effectiveMode !== 'comment') {
      setTextTarget((target) => (target?.kind === 'comment' ? null : target))
    }
  }, [effectiveMode])

  // Compact or coarse-pointer screens: rail and margin cards give way to
  // anchor markers, a bottom dock, and sheets — the full product, rearranged
  // for one hand. The pointer branch catches wide landscape iPads. Masked by isClient
  // so the first render is the desktop layout on both server and client (the
  // matchMedia read happens only after mount) — the responsive collapse then
  // applies one frame later, matching the editor mount.
  const rawIsMobile = useMediaQuery('(max-width: 72rem), (hover: none) and (pointer: coarse)')
  const isMobile = isClient && rawIsMobile
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null)
  const [sheetFocusKey, setSheetFocusKey] = useState<string | null>(null)
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  useEffect(() => {
    if (!isMobile) setActiveSheet(null)
  }, [isMobile])

  // Read mode has no text-targeted or review actions. Clear anything opened
  // in another mode so switching always lands on a clean document view.
  // (The composer clears itself on any mode switch — see useComments.)
  useEffect(() => {
    if (!isReading) return
    setTextTarget(null)
    setSuggestionNotice(null)
    setActiveSheet(null)
  }, [isReading, setSuggestionNotice])

  useEffect(() => {
    if (!handle || !isReading) return

    return bindReadPointerBroadcast(handle.editor, handle.provider.awareness)
  }, [handle, isReading])

  // Non-editable modes (Read, Comment) never route copies through
  // ProseMirror, so bind the clean-clipboard fallback for them. The handler
  // no-ops while the view is editable.
  useEffect(() => {
    if (!handle) return

    return bindReadModeCopy(handle.editor)
  }, [handle])

  const { peers, followingClientId, toggleFollow } = useFollowPresence(handle)

  // Persist cookie-backed prefs on change so their next SSR paint matches.
  // Mode is intentionally absent: its shareable URL and Inertia history entry
  // are the durable source of truth now.
  useEffect(() => {
    setCookieFlag('pruf_panel', panelOpen)
  }, [panelOpen])
  useEffect(() => {
    setCookieFlag('pruf_focus', focusMode)
  }, [focusMode])

  // An owner may lock editing while another viewer is on a write-mode URL.
  // Replace (rather than push) that now-invalid entry with canonical Read so
  // Back cannot return the viewer to an unavailable mode.
  useEffect(() => {
    if (demoModeLocked || availableModes.includes(ui.mode)) return

    router.replace<DocumentProps>({
      url: documentModePath(doc.slug, 'read'),
      props: (props) => ({
        ...props,
        ui: { ...props.ui, mode: 'read' },
      }),
      preserveState: true,
      preserveScroll: true,
    })
  }, [availableModes, demoModeLocked, doc.slug, ui.mode])

  // ⌘1–4 selects Edit/Suggest/Comment/Read. ⌘\ toggles the side panel,
  // and ⌘. toggles suggestion focus. Control mirrors Command for parity.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const shortcutMode = MODE_SHORTCUTS[event.code] ?? MODE_SHORTCUTS[`Digit${event.key}`]
      if (shortcutMode) {
        if (modeLocked || !availableModes.includes(shortcutMode)) return
        event.preventDefault()
        changeMode(shortcutMode)
        return
      }
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
  }, [availableModes, changeMode, modeLocked])

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
  const reloadEditingAccess = useCallback(() => {
    router.reload({
      only: ownership.yours ? ['ownership'] : ['document', 'ownership'],
      async: true,
    })
  }, [ownership.yours])
  const recoverDeniedWrite = useCallback(() => {
    router.reload({ only: ['document', 'ownership', 'viewer'], async: true })
  }, [])
  const reloadAfterContentReset = useCallback(() => {
    presencePoll.stop()
    window.location.reload()
  }, [presencePoll])
  useMetaChannel(doc.slug, {
    onDeleted: onDocumentGone,
    onTitle: setDocumentTitle,
    onVersionAvailable: () => setNewVersionAvailable(true),
    onEditingLock: reloadEditingAccess,
    onContentReset: reloadAfterContentReset,
    connectionIdentity,
  })

  // The sync channel rejects its resubscription when the doc is gone —
  // same exit path.
  useEffect(() => {
    if (!handle) return
    const provider = handle.provider
    provider.on('rejected', onDocumentGone)
    provider.on('write-denied', recoverDeniedWrite)
    // This tab's local doc predates an owner CLI replacement: either a frame
    // it sent was rejected for staleness (its content_generation is behind),
    // or a reconnect handshake reported a generation different from the one
    // it last synced. Both fire when the content_reset broadcast was missed
    // or raced — same recovery action as content_reset, reached via the
    // sync channel instead.
    provider.on('stale', reloadAfterContentReset)
    return () => {
      provider.off('rejected', onDocumentGone)
      provider.off('write-denied', recoverDeniedWrite)
      provider.off('stale', reloadAfterContentReset)
    }
  }, [handle, onDocumentGone, recoverDeniedWrite, reloadAfterContentReset])

  // Priority-ordered dispatch: text selection → mobile suggestion tap →
  // click-to-comment → AI review span. Exactly one target (or none) comes
  // out — the single textTarget cell makes that mutual exclusion structural.
  const handleSelection = useCallback((view: EditorView) => {
    viewRef.current = view
    const { from, to, empty } = view.state.selection

    // Only require focus when the view is editable: in Comment mode the
    // root is contenteditable=false, which browsers never focus, so
    // hasFocus() is always false and the focus gate would make the selection
    // toolbar unreachable in the read-only mode.
    if (view.editable && !view.hasFocus()) {
      setTextTarget(null)
      return
    }

    if (!empty) {
      const text = view.state.doc.textBetween(from, to, '\n')
      if (text.trim().length > 0) {
        setTextTarget({ kind: 'selection', text })
        return
      }
    }

    // Mobile: tapping inside a pending suggestion's tinted anchor opens its
    // sheet card — the touch equivalent of glancing at the margin. The
    // review items carry ranges from the same parser-aware matcher the
    // cards anchor with, resolved once per doc version, so this is a plain
    // containment check instead of per-suggestion document scans.
    if (isMobileRef.current && empty) {
      const pos = view.state.selection.head
      const hit = reviewItemsRef.current.find(
        (item) =>
          !item.inline && item.range && pos >= item.range.from && pos <= item.range.to,
      )
      if (hit) {
        setSheetFocusKey(hit.key)
        setActiveSheet('suggestions')
        setTextTarget(null)
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
        setTextTarget({ kind: 'comment', text: capAnchor(text) })
        return
      }
    }

    const span = aiSpanAt(view.state)
    setTextTarget(span ? { kind: 'review', span } : null)
  }, [])

  // Review/selection chrome belongs to the text that opened it. ProseMirror
  // does not dispatch a selection transaction when focus moves to page
  // chrome, so explicitly clear these transient targets on outside clicks.
  // Keep clicks on the floating chrome itself alive so its actions still run.
  useEffect(() => {
    let editorClickRaf = 0
    const clearTextTarget = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.milkdown .ProseMirror')) {
        // A dismissed popover leaves ProseMirror's cursor where it was. A
        // second click on that exact span therefore produces no selection
        // transaction, so explicitly re-evaluate provenance after the click.
        if (target.closest('[data-provenance]')) {
          if (editorClickRaf) cancelAnimationFrame(editorClickRaf)
          editorClickRaf = requestAnimationFrame(() => {
            editorClickRaf = 0
            const view = viewRef.current
            if (view) handleSelection(view)
          })
        }
        return
      }
      if (
        target.closest('.selection-toolbar, .review-popover, .comment-composer--anchored')
      ) {
        return
      }

      setTextTarget(null)
    }

    window.addEventListener('pointerdown', clearTextTarget, true)
    return () => {
      if (editorClickRaf) cancelAnimationFrame(editorClickRaf)
      window.removeEventListener('pointerdown', clearTextTarget, true)
    }
  }, [handleSelection])

  const handleAdvance = useCallback((state: ReviewState) => {
    const view = viewRef.current
    if (!view) return
    const span = aiSpanAt(view.state)
    if (!span) return
    applyReviewState(view, span, state)
  }, [])

  const {
    composerAnchor,
    composerOpen,
    openComposer,
    closeComposer,
    cancelComposer,
    submitComment,
    submitAnchoredComment,
    resolveComment,
    jumpToAnchor,
  } = useComments({
    slug: doc.slug,
    identityName: identity.name,
    viewRef,
    effectiveMode,
    isMobile,
    docTick,
  })

  // The comment composer lives in the comments panel — on mobile that means
  // opening its sheet when a selection chooses "Comment".
  useEffect(() => {
    if (isMobile && composerAnchor !== null) setActiveSheet('comments')
  }, [isMobile, composerAnchor])

  // Highlighter legend content, re-scanned from the live doc whenever it
  // changes (docTick — the same recompute signal the review surfaces use).
  const highlightGroups = useMemo<HighlightGroup[]>(() => {
    void docTick
    if (!handle) return []
    let groups: HighlightGroup[] = []
    try {
      handle.editor.action((ctx) => {
        groups = collectHighlights(ctx.get(editorViewCtx).state.doc)
      })
    } catch {
      // view not mounted yet
    }
    return groups
  }, [handle, docTick])

  // Applying colors mutates document content, so the swatches follow the
  // write capability, not just the visible toolbar (Comment mode selections
  // keep offering Comment only).
  const canHighlight = ownership.can_write && effectiveMode === 'edit'
  // The selection's uniform color (drives the remove-on-reclick affordance).
  // textTarget is recreated on every selection/doc change, so this stays
  // fresh after a swatch click without a dedicated subscription.
  const activeHighlightColor = useMemo(() => {
    void docTick
    const view = viewRef.current
    if (!canHighlight || !view || textTarget?.kind !== 'selection') return null
    return selectionHighlightColor(view.state)
  }, [canHighlight, textTarget, docTick])

  const highlightSwatches = useMemo(() => {
    if (!canHighlight) return undefined
    return HIGHLIGHT_COLORS.map((color) => ({
      id: color.id,
      label: highlightNames[color.id] || color.label,
      color: color.swatch,
      active: activeHighlightColor === color.id,
      onClick: () => {
        const view = viewRef.current
        if (!view) return
        if (activeHighlightColor === color.id) removeHighlight(view)
        else applyHighlight(view, color.id)
        view.focus()
      },
    }))
  }, [canHighlight, highlightNames, activeHighlightColor])

  const jumpToHighlight = useCallback((snippet: HighlightSnippet) => {
    const view = viewRef.current
    if (!view) return
    // Positions come from the last scan; a remote edit landing between scan
    // and click could shift them, so clamp instead of throwing.
    const max = view.state.doc.content.size
    if (snippet.from >= snippet.to || snippet.to > max) return
    const tr = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, snippet.from, snippet.to),
    )
    tr.scrollIntoView()
    view.dispatch(tr)
    view.focus()
  }, [])

  // One floating form at a time: an open composer suppresses the selection
  // chrome, and so does the share popover (z-60, above the chrome's z-50).
  const [shareOpen, setShareOpen] = useState(false)

  const {
    selectionToolbarActive,
    selectionPopover,
    commentAffordanceActive,
    commentAffordance,
    liveReviewSpan,
    reviewActive,
    reviewPopover,
    composerPopover,
  } = useFloatingChrome({
    viewRef,
    textTarget,
    composerAnchor,
    composerOpen,
    chromeSuppressed: composerOpen || shareOpen,
    spans,
    docTick,
    isMobile,
  })

  const documentStyle = {
    ...(documentWidth === null ? {} : { '--document-width': `${documentWidth}px` }),
    ...(richContentWidth === null ? {} : { '--rich-content-width': `${richContentWidth}px` }),
  } as CSSProperties

  return (
    <>
      <Head title={documentTitle} />
      <NativeDocBridge
        documentTitle={documentTitle}
        availableModes={availableModes}
        effectiveMode={effectiveMode}
        modeLocked={modeLocked}
        isReading={isReading}
        changeMode={changeMode}
        onToggleActivity={() =>
          setActiveSheet((current) => (current === 'activity' ? null : 'activity'))
        }
        exportReady={Boolean(handle)}
        onExportMarkdown={exportMarkdown}
        onExportHtml={exportHtml}
      />
      <div
        className={`doc-page ${panelOpen ? '' : 'is-panel-hidden'} ${isReading ? 'is-read-mode' : ''}`}
        style={Object.keys(documentStyle).length === 0 ? undefined : documentStyle}
      >
        {/* The update prompt normally lives in the (native-hidden) header; it
            is the only trigger for reloading an owner-reset or newly deployed
            document, so in the app it floats on its own. */}
        {nativeApp && newVersionAvailable && (
          <button
            type="button"
            className="version-update version-update--native"
            onClick={() => window.location.reload()}
          >
            New version · Update
          </button>
        )}
        <header className="doc-header native-hidden">
          <div className="doc-header-left">
            {/* The nav bar's leading button (-> #native-doc-back) owns back in
                the native shell now that this header hides there; the old
                header back button had no other consumer. */}
            <Link href="/" className="doc-home" aria-label="Home">
              T.
            </Link>
            <span className="doc-title">{documentTitle}</span>
            <ModeControl
              mode={effectiveMode}
              onChange={changeMode}
              availableModes={availableModes}
              locked={modeLocked}
              lockedReason={
                modeLocked && !demoModeLocked
                  ? 'Can view — the owner limited this link to reading'
                  : undefined
              }
            />
            <span
              className={`doc-status doc-status--${status}`}
              title={status === 'live' ? 'Connected — edits sync live' : 'Connecting…'}
            />
            {newVersionAvailable && (
              <button
                type="button"
                className="version-update"
                onClick={() => window.location.reload()}
              >
                New version · Update
              </button>
            )}
          </div>
          <div className="doc-header-right">
            {/* ≤3 groups: presence/identity · Share · ⋯ menu. Presence sits on
                the cluster's open left edge (its reserved lane blends into the
                header's free middle space) and your own identity chip anchors
                the right, next to Share. */}
            <div className="doc-header-people">
              <PresenceBar
                humans={peers}
                agents={presences}
                compact={isMobile}
                followingClientId={followingClientId}
                onFollow={toggleFollow}
              />
              {!isReading && <ProvenanceSummaryChip spans={spans} />}
              <IdentityChip
                identity={identity}
                guest={guest}
                authenticated={Boolean(viewer.account)}
                onRenamed={handleRenamed}
              />
            </div>
            {!isReading && pendingSuggestionCount > 1 && (
              <button
                className="accept-all-button"
                disabled={acceptingAll}
                onClick={() => void acceptAllSuggestions()}
                {...nativeHaptic('success')}
              >
                {acceptingAll ? 'Accepting…' : `Accept all ${pendingSuggestionCount}`}
              </button>
            )}
            <SharePopover
              agentsActive={presences.length}
              exportReady={Boolean(handle)}
              linkAccess={ownership.link_access}
              canChangeAccess={ownership.yours}
              onExportMarkdown={exportMarkdown}
              onExportHtml={exportHtml}
              onPrint={printDocument}
              onOpenChange={setShareOpen}
            />
            <HeaderMenu
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen((open) => !open)}
              focusMode={focusMode}
              onToggleFocus={() => setFocusMode((focus) => !focus)}
              slug={doc.slug}
              ownership={ownership}
              claimerName={identity.name}
              account={viewer.account}
              feedbackAutomationEnabled={viewer.feedback_automation_enabled}
            />
          </div>
        </header>
        {!isReading && (
          <ClaimBanner slug={doc.slug} ownership={ownership} claimerName={identity.name} />
        )}
        {!isReading && suggestionNotice && (
          <div className="doc-notice" role="status">
            <span>{suggestionNotice}</span>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setSuggestionNotice(null)}
            >
              Dismiss
            </button>
          </div>
        )}
        <main className="doc-body">
          <div className={`doc-canvas ${focusMode ? 'is-focus' : ''}`}>
            <article className="doc-main">
              {/* Keyed on the permission-scoped session: a permission flip
                  remounts the whole stage, so a delayed callback from the old
                  editor can never hide the preview for a new remount. */}
              <StagedDocumentEditor
                key={editorSessionKey}
                contentHtml={doc.content_html}
                isClient={isClient}
                onHandle={setHandle}
                slug={doc.slug}
                identity={identity}
                canWrite={ownership.can_write}
                connectionIdentity={connectionIdentity}
                contentFormat={doc.content_format}
                initialStateB64={doc.yjs_state_b64}
                renderHints={doc.render_hints}
                seedContent={doc.seed_content}
                seedVersion={doc.seed_version}
                seedGranted={doc.seed_granted}
                seedAuthorKind={doc.seed_author_kind}
                seedAuthorName={doc.seed_author_name}
                editable={ownership.can_write && (effectiveMode === 'edit' || effectiveMode === 'suggest')}
                suggesting={ownership.can_write && effectiveMode === 'suggest'}
                taskInteractive={ownership.can_write && effectiveMode !== 'comment'}
                onStatus={setStatus}
                onSpans={setSpans}
                onSelection={isReading ? undefined : handleSelection}
                onTitleChange={setDocumentTitle}
              />
            </article>
            <DocumentWidthHandle
              width={documentWidth}
              onChange={setDocumentWidth}
              onCommit={(width) => setCookie('pruf_width', String(width))}
              onReset={() => {
                setDocumentWidth(null)
                setCookie('pruf_width', 'default')
              }}
            />
            {!isReading && (
              <div className="margin-gutter">
                <MarginSuggestions
                  items={reviewItems}
                  handle={handle}
                  focusMode={focusMode || isMobile}
                  onMarkerSelect={
                    isMobile
                      ? (item: ReviewableSuggestion) => {
                          setSheetFocusKey(item.key)
                          setActiveSheet('suggestions')
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </div>
          {!isReading && !isMobile && (
            <aside className="doc-rail">
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
              <HighlightLegendPanel
                groups={highlightGroups}
                names={highlightNames}
                canWrite={ownership.can_write}
                slug={doc.slug}
                onJumpTo={jumpToHighlight}
              />
              <ActivityPanel activities={activities} />
            </aside>
          )}
        </main>
        {!isReading && textTarget?.kind === 'selection' && selectionToolbarActive && (
          <SelectionToolbar
            rootRef={selectionPopover.ref}
            position={selectionPopover.position}
            actions={[
              {
                label: 'Comment',
                onClick: () => {
                  openComposer(textTarget.text)
                  setTextTarget(null)
                },
              },
            ]}
            swatches={highlightSwatches}
          />
        )}
        {!isReading && textTarget?.kind === 'comment' && commentAffordanceActive && (
          <SelectionToolbar
            rootRef={commentAffordance.ref}
            position={commentAffordance.position}
            actions={[
              {
                label: 'Comment on this paragraph',
                onClick: () => {
                  openComposer(textTarget.text)
                  setTextTarget(null)
                },
              },
            ]}
          />
        )}
        {!isReading && liveReviewSpan && reviewActive && (
          <ReviewPopover
            rootRef={reviewPopover.ref}
            span={liveReviewSpan}
            position={reviewPopover.position}
            onAdvance={handleAdvance}
          />
        )}
        {!isReading && composerOpen && composerAnchor !== null && (
          <AnchoredComposer
            key={composerAnchor}
            rootRef={composerPopover.ref}
            anchor={composerAnchor}
            position={composerPopover.position}
            onSubmit={submitAnchoredComment}
            onCancel={closeComposer}
          />
        )}
        {!isReading && isMobile && (
          <MobileDock
            suggestionCount={reviewItems.length}
            commentCount={comments.filter((c) => !c.resolved).length}
            active={activeSheet}
            onOpen={(kind) => setActiveSheet((current) => (current === kind ? null : kind))}
          />
        )}
        {!isReading && isMobile && activeSheet === 'suggestions' && (
          <MobileSheet
            title={`Suggestions${reviewItems.length > 0 ? ` · ${reviewItems.length}` : ''}`}
            onClose={() => {
              setActiveSheet(null)
              setSheetFocusKey(null)
            }}
          >
            <SuggestionSheetList
              items={reviewItems}
              focusKey={sheetFocusKey}
              onAcceptAll={pendingSuggestionCount > 1 ? acceptAllSuggestions : undefined}
              acceptingAll={acceptingAll}
            />
          </MobileSheet>
        )}
        {!isReading && isMobile && activeSheet === 'comments' && (
          <MobileSheet title="Comments" onClose={() => setActiveSheet(null)}>
            <CommentsPanel
              comments={comments}
              composerAnchor={composerAnchor}
              onSubmit={submitComment}
              onCancelComposer={cancelComposer}
              onResolve={resolveComment}
              onJumpTo={(anchorText) => {
                jumpToAnchor(anchorText)
                setActiveSheet(null)
              }}
            />
          </MobileSheet>
        )}
        {!isReading && isMobile && activeSheet === 'activity' && (
          <MobileSheet title="Activity" onClose={() => setActiveSheet(null)}>
            <ActivityPanel activities={activities} />
          </MobileSheet>
        )}
      </div>
    </>
  )
}
