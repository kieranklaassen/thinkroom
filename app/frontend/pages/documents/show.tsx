import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Head, Link, router, usePoll } from '@inertiajs/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  DocumentEditor,
  type ConnectionStatus,
  type EditorHandle,
} from '../../editor/milkdown_editor'
import type { DocumentFormat } from '../../editor/document_format'
import {
  userIdentity,
  serverIdentity,
  serverKnewGuest,
  persistGuestIdentity,
  reconcileGuestCookie,
  storedGuestIdentity,
  type UserIdentity,
} from '../../editor/identity'
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
  findSuggestionTarget,
  findTextRange,
  flashMergedRange,
  suggestionApplicability,
  type SuggestionPayload,
} from '../../editor/suggestions'
import { refreshAgentCursors } from '../../editor/agent_cursors'
import { bindReadPointerBroadcast } from '../../editor/read_pointers'
import { bindViewportBroadcast, bindViewportFollow } from '../../editor/viewport_follow'
import { editorViewCtx, parserCtx, schemaCtx } from '@milkdown/kit/core'
import { sourceParser } from '../../editor/document_format'
import {
  downloadDocumentHtml,
  downloadDocumentMarkdown,
  printDocument,
} from '../../editor/document_export'
import { collectInlineSuggestions } from '../../editor/suggest_changes'
import {
  MarginInlineSuggestions,
  InlineSuggestionSheetList,
} from '../../components/margin_inline_suggestions'
import { ProvenanceSummaryChip } from '../../components/provenance_summary'
import { ReviewPopover } from '../../components/review_popover'
import { MarginSuggestions } from '../../components/margin_suggestions'
import { CommentsPanel, type CommentPayload } from '../../components/comments_panel'
import { AnchoredComposer } from '../../components/anchored_composer'
import { SelectionToolbar } from '../../components/selection_toolbar'
import {
  PresenceBar,
  type AgentPresencePayload,
  type HumanPresence,
} from '../../components/presence_bar'
import { ActivityPanel } from '../../components/activity_panel'
import { IdentityChip } from '../../components/identity_chip'
import { type OwnershipPayload } from '../../components/ownership_chip'
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
import { useMetaChannel } from '../../lib/use_meta_channel'
import { useMediaQuery } from '../../lib/use_media_query'
import { useIsClient } from '../../lib/use_is_client'
import { useAnchoredPopover } from '../../lib/use_anchored_popover'
import { domRange, setHighlight, clearHighlight } from '../../lib/highlights'
import { patchJSON } from '../../lib/csrf'
import type { ViewerPayload } from '../../types/viewer'
import { setCookie, setCookieFlag } from '../../lib/cookies'
import {
  RICH_BLOCK_WIDTH_EVENT,
  type RichBlockWidthEventDetail,
} from '../../editor/rich_block_width'
import './show.css'

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
    content_format: DocumentFormat
    seed_content: string | null
    seed_version: string
    seed_granted: boolean
    seed_author_kind: string | null
    seed_author_name: string | null
    has_state: boolean
    yjs_state_b64: string | null
    content_html: string
    display_title: string
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

const documentModePath = (slug: string, mode: EditorMode) =>
  `/d/${encodeURIComponent(slug)}${mode === 'read' ? '' : `/${mode}`}`

const availableDocumentModes = (ownership: OwnershipPayload): EditorMode[] => {
  if (ownership.can_write) return ['edit', 'suggest', 'comment', 'read']
  if (ownership.can_comment) return ['comment', 'read']
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

const skippedSuggestionNotice = (count: number): string =>
  `${count} suggestion${count === 1 ? '' : 's'} skipped because the target is missing, ambiguous, or empty; ${count === 1 ? 'it remains' : 'they remain'} pending for individual review.`

export default function DocumentShow({
  document: doc,
  viewer,
  ui,
  ownership,
  suggestions,
  comments,
  activities,
  presences,
}: DocumentProps) {
  // SSR/hydration island flag: the live editor and any render-time browser
  // reads are gated on this so the server (and the client's first hydration
  // render) produce identical markup. It flips true on the next client commit.
  const isClient = useIsClient()

  // Initializer-only state plus an explicit rename handler — NOT a
  // sync-on-prop-change effect, which a future reload batch listing
  // `viewer` would silently clobber mid-rename.
  //
  // Hydration-safe init: server and the first client render BOTH derive
  // identity from the viewer prop alone — the chosen session name, else the
  // guest name + color the server read from the `pruf_guest` cookie, else
  // Anonymous. No localStorage read during render, so the markup is
  // byte-identical (zero hydration mismatch).
  //
  // When the cookie was present (the common returning-user case) the server
  // already rendered the real guest identity → NOTHING changes post-hydration.
  // Only when the cookie was absent (first-ever load, or a user whose identity
  // predates the cookie) does the post-hydration effect reconcile from
  // localStorage and write the cookie so the NEXT load is server-correct.
  const [identity, setIdentity] = useState<UserIdentity>(() =>
    serverIdentity(viewer.name, viewer),
  )
  useEffect(() => {
    // A chosen session name always wins and is server-known — never overridden
    // by the guest identity.
    if (viewer.name) return
    if (serverKnewGuest(viewer)) {
      // Server already rendered the cookie-backed guest identity. Re-seed
      // localStorage from it when storage is empty (cookie present but storage
      // cleared) so the cookie stays authoritative — never regenerate a fresh
      // identity here, which would silently rename the user on the next load.
      // Do NOT change React state: that would be the post-hydration flip we
      // just worked to avoid.
      if (!storedGuestIdentity()) persistGuestIdentity(identity)
      return
    }
    // Cookie absent: reconcile from localStorage (one-time migration) and write
    // the cookie. If there's no stored identity yet, generate + persist one.
    const stored = storedGuestIdentity()
    setIdentity(stored ?? reconcileGuestCookie())
    if (stored) persistGuestIdentity(stored)
    // viewer is stable for the life of the page; the rename handler owns
    // subsequent identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [guest, setGuest] = useState(viewer.guest)
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
  const [readyEditor, setReadyEditor] = useState<{
    key: string
    handle: EditorHandle
  } | null>(null)
  const [swappedEditorKey, setSwappedEditorKey] = useState<string | null>(null)
  const [spans, setSpans] = useState<ProvenanceSpan[]>([])
  const [peers, setPeers] = useState<HumanPresence[]>([])
  const [followingClientId, setFollowingClientId] = useState<number | null>(null)
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const [selectionTarget, setSelectionTarget] = useState<SelectionTarget | null>(null)
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null)
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<string | null>(null)
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
    () => availableDocumentModes(ownership),
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
  const handle = readyEditor?.key === editorSessionKey ? readyEditor.handle : null
  // Tie the instant-paint swap to the exact permission-keyed editor. A delayed
  // callback from the old editor can never hide the preview for a new remount.
  const editorSwapped = swappedEditorKey === editorSessionKey
  // Live handle for code that runs after awaits or inside stable callbacks —
  // a closure-captured handle goes stale when the editor remounts mid-flight.
  const handleRef = useRef<EditorHandle | null>(null)
  handleRef.current = handle
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
    if (effectiveMode !== 'comment') setCommentTarget(null)
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
  const [sheetFocusId, setSheetFocusId] = useState<number | null>(null)
  const suggestionsRef = useRef(suggestions)
  suggestionsRef.current = suggestions
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  useEffect(() => {
    if (!isMobile) setActiveSheet(null)
  }, [isMobile])

  // Read mode has no text-targeted or review actions. Clear anything opened
  // in another mode so switching always lands on a clean document view.
  useEffect(() => {
    if (!isReading) return
    setReviewTarget(null)
    setSelectionTarget(null)
    setCommentTarget(null)
    setComposerAnchor(null)
    setSuggestionNotice(null)
    setActiveSheet(null)
  }, [isReading])

  useEffect(() => {
    if (!handle || !isReading) return

    return bindReadPointerBroadcast(handle.editor, handle.provider.awareness)
  }, [handle, isReading])

  useEffect(() => {
    if (!handle) return

    return bindViewportBroadcast(handle.editor, handle.provider.awareness)
  }, [handle])

  useEffect(() => {
    if (!handle || followingClientId === null) return
    const targetId = followingClientId

    return bindViewportFollow(
      handle.editor,
      handle.provider.awareness,
      targetId,
      () => setFollowingClientId((current) => current === targetId ? null : current),
    )
  }, [followingClientId, handle])

  useEffect(() => {
    if (followingClientId === null) return
    const release = () => setFollowingClientId(null)
    const releaseOutsidePresence = (event: PointerEvent | TouchEvent) => {
      const target = event.target as Element | null
      if (target?.closest('.presence-avatar--human')) return
      release()
    }
    const releaseOnNavigationKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
        release()
      }
    }

    window.addEventListener('wheel', release, { passive: true })
    window.addEventListener('touchstart', releaseOutsidePresence, { passive: true })
    window.addEventListener('pointerdown', releaseOutsidePresence, { passive: true })
    window.addEventListener('keydown', releaseOnNavigationKey)
    return () => {
      window.removeEventListener('wheel', release)
      window.removeEventListener('touchstart', releaseOutsidePresence)
      window.removeEventListener('pointerdown', releaseOutsidePresence)
      window.removeEventListener('keydown', releaseOnNavigationKey)
    }
  }, [followingClientId])

  // The comment composer lives in the comments panel — on mobile that means
  // opening its sheet when a selection chooses "Comment".
  useEffect(() => {
    if (isMobile && composerAnchor !== null) setActiveSheet('comments')
  }, [isMobile, composerAnchor])

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

  // Human presence from Yjs awareness. Self is filtered out — the
  // IdentityChip represents you; a duplicate avatar next to it is noise.
  useEffect(() => {
    if (!handle) return
    const { awareness } = handle.provider
    const selfId = handle.provider.doc.clientID
    const update = () => {
      const states = Array.from(awareness.getStates().entries())
      const nextPeers = states
        .filter(([clientId]) => clientId !== selfId)
        .map(([clientId, state]) => {
          const user = (state as { user?: UserIdentity }).user
          return user ? { ...user, clientId } : null
        })
        .filter((user): user is HumanPresence => Boolean(user))
      setPeers((current) =>
        current.length === nextPeers.length && current.every((peer, index) => {
          const next = nextPeers[index]
          return next &&
            peer.clientId === next.clientId &&
            peer.name === next.name &&
            peer.color === next.color
        })
          ? current
          : nextPeers,
      )
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [handle])

  useEffect(() => {
    if (
      followingClientId !== null &&
      !peers.some((peer) => peer.clientId === followingClientId)
    ) {
      setFollowingClientId(null)
    }
  }, [followingClientId, peers])

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
    // A frame this tab sent was rejected for staleness: an owner CLI
    // replacement reset the document since this tab last synced (its
    // content_generation is behind). This can fire even when the
    // content_reset broadcast was missed or raced with the outgoing frame —
    // same recovery action as content_reset, reached via a second path.
    provider.on('stale', reloadAfterContentReset)
    return () => {
      provider.off('rejected', onDocumentGone)
      provider.off('write-denied', recoverDeniedWrite)
      provider.off('stale', reloadAfterContentReset)
    }
  }, [handle, onDocumentGone, recoverDeniedWrite, reloadAfterContentReset])

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
    // sheet card — the touch equivalent of glancing at the margin. Same
    // parser-aware matcher the cards anchor with, so markdown-quoting
    // suggestions hit-test at their real ranges.
    if (isMobileRef.current && empty) {
      const pos = view.state.selection.head
      const parser = handleRef.current
        ? handleRef.current.editor.action((ctx) =>
            sourceParser(doc.content_format, ctx.get(parserCtx), ctx.get(schemaCtx)),
          )
        : null
      const hit = parser
        ? suggestionsRef.current.find((s) => {
            const range = findSuggestionTarget(
              view.state.doc,
              parser,
              s.replaces ?? s.anchor_text,
              doc.content_format,
            )
            return range !== null && pos >= range.from && pos <= range.to
          })
        : undefined
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
  }, [doc.content_format])

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

      setReviewTarget(null)
      setSelectionTarget(null)
      setCommentTarget(null)
    }

    window.addEventListener('pointerdown', clearTextTarget, true)
    return () => {
      if (editorClickRaf) cancelAnimationFrame(editorClickRaf)
      window.removeEventListener('pointerdown', clearTextTarget, true)
    }
  }, [handleSelection])

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

  const reopenSuggestion = useCallback(
    async (suggestionId: number): Promise<boolean> => {
      try {
        const response = await patchJSON(`/suggestions/${suggestionId}/reopen`, {
          by: identity.name,
        })
        if (response.ok) return true
        console.warn('pruf: suggestion reopen rejected', suggestionId, response.status)
      } catch (error) {
        console.warn('pruf: suggestion reopen failed', suggestionId, error)
      }
      return false
    },
    [identity.name],
  )

  // Promise-based single accept, shared by the per-card button and Accept
  // all. The card clears optimistically, but the CRDT insert waits for the
  // server to confirm THIS client won the accept — otherwise two windows
  // accepting concurrently would each insert the text (the loser's PATCH
  // 422s, but a local-first insert could not be rolled back). The promise
  // settles on finish regardless of outcome so a bulk loop never stalls on
  // a suggestion someone else resolved first.
  const acceptOne = useCallback(
    (suggestion: SuggestionPayload) =>
      new Promise<void>((resolve) => {
        // Optimistic placeholders (negative id) have no server row yet —
        // a PATCH against them would 404.
        if (!handle || suggestion.id < 0) {
          resolve()
          return
        }
        const applicability = suggestionApplicability(
          handle.editor,
          suggestion,
          doc.content_format,
        )
        if (!applicability.ok) {
          setSuggestionNotice(
            applicability.reason === 'ambiguous'
              ? 'This quoted text appears more than once. The suggestion is still pending so no content was changed.'
              : applicability.reason === 'missing'
                ? 'The quoted text has changed or was removed. The suggestion is still pending so no content was changed.'
                : 'This suggestion has no editable content and was left pending.',
          )
          resolve()
          return
        }
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
                const merged = applySuggestion(handle.editor, suggestion, doc.content_format)
                // A one-beat pulse on the merged text — the reward for review.
                if (merged) {
                  flashMergedRange(handle.editor, merged)
                } else {
                  void reopenSuggestion(suggestion.id).then((reopened) => {
                    setSuggestionNotice(
                      reopened
                        ? 'The document changed before this suggestion could be merged. It was returned to pending.'
                        : 'The document changed before this suggestion could be merged, and Thinkroom could not restore it to pending. Refresh before reviewing it again.',
                    )
                    router.reload({ only: ['suggestions', 'activities'], async: true })
                  })
                }
              },
              onFinish: () => resolve(),
            },
          )
      }),
    [handle, identity.name, doc.content_format, reopenSuggestion],
  )

  const acceptSuggestion = useCallback(
    (suggestion: SuggestionPayload) => {
      void acceptOne(suggestion)
    },
    [acceptOne],
  )

  // Accept all applicable suggestions in ONE round trip: the server flips
  // the selected rows atomically and returns the winners, then the bodies
  // merge into the CRDT locally in id order — each merge re-anchors against the
  // post-merge document, exactly as if the cards were clicked one by one,
  // minus the per-card network wait. Cards hide optimistically while the
  // request is in flight; the broadcast-driven props reload makes the
  // clearing durable, and a failed request lets the cards reappear.
  const [acceptingSuggestionIds, setAcceptingSuggestionIds] = useState<Set<number>>(
    () => new Set(),
  )
  const acceptingAll = acceptingSuggestionIds.size > 0
  const acceptAllSuggestions = useCallback(async () => {
    if (acceptingAll || !handleRef.current) return
    const pending = suggestionsRef.current.filter((s) => s.id > 0)
    if (pending.length === 0) return
    const applicable: SuggestionPayload[] = []
    const blocked: SuggestionPayload[] = []
    for (const suggestion of pending) {
      const result = suggestionApplicability(
        handleRef.current.editor,
        suggestion,
        doc.content_format,
      )
      if (result.ok) {
        applicable.push(suggestion)
      } else {
        blocked.push(suggestion)
      }
    }
    if (applicable.length === 0) {
      setSuggestionNotice(skippedSuggestionNotice(blocked.length))
      return
    }
    setSuggestionNotice(null)
    setAcceptingSuggestionIds(new Set(applicable.map((suggestion) => suggestion.id)))
    let succeeded = false
    try {
      const response = await patchJSON(`/d/${doc.slug}/suggestions/accept_all`, {
        by: identity.name,
        ids: applicable.map((suggestion) => suggestion.id),
      })
      if (response.ok) {
        const { accepted } = (await response.json()) as { accepted: SuggestionPayload[] }
        let reopened = 0
        let reopenFailed = 0
        for (const suggestion of accepted) {
          // Live handle: the editor can remount during the awaits above.
          const live = handleRef.current
          if (!live) {
            if (await reopenSuggestion(suggestion.id)) {
              reopened += 1
            } else {
              reopenFailed += 1
            }
            continue
          }
          try {
            const merged = applySuggestion(live.editor, suggestion, doc.content_format)
            if (merged) {
              flashMergedRange(live.editor, merged)
            } else if (await reopenSuggestion(suggestion.id)) {
              reopened += 1
            } else {
              reopenFailed += 1
            }
          } catch (error) {
            console.warn('pruf: bulk merge failed for suggestion', suggestion.id, error)
            if (await reopenSuggestion(suggestion.id)) {
              reopened += 1
            } else {
              reopenFailed += 1
            }
          }
        }
        const notices: string[] = []
        if (blocked.length > 0) {
          notices.push(skippedSuggestionNotice(blocked.length))
        }
        if (reopenFailed > 0) {
          notices.push(
            `${reopenFailed} suggestion${reopenFailed === 1 ? '' : 's'} could not be restored to pending after the document changed. Refresh before reviewing again.`,
          )
        } else if (reopened > 0) {
          notices.push(
            `${reopened} suggestion${reopened === 1 ? '' : 's'} changed before merging and returned to pending.`,
          )
        }
        setSuggestionNotice(notices.length > 0 ? notices.join(' ') : null)
        succeeded = true
      } else {
        console.warn('pruf: accept all rejected', response.status)
      }
    } catch (error) {
      console.warn('pruf: accept all failed', error)
    } finally {
      if (succeeded) {
        // Hold the optimistic clearing until fresh props land — releasing
        // before the reload finishes flashes the accepted cards (and the
        // header button) back for a full round trip. The broadcast-driven
        // debounced reload still covers every other client.
        router.reload({
          only: ['suggestions', 'activities'],
          async: true,
          onFinish: () => setAcceptingSuggestionIds(new Set()),
        })
      } else {
        // Failure: release immediately so the cards reappear (rollback).
        setAcceptingSuggestionIds(new Set())
      }
    }
  }, [acceptingAll, doc.slug, doc.content_format, identity.name, reopenSuggestion])

  // Optimistic clearing for the bulk path: server-backed cards vanish the
  // moment Accept all is clicked; optimistic placeholders (negative ids,
  // not part of the batch) and blocked suggestions stay visible.
  const visibleSuggestions = acceptingAll
    ? suggestions.filter((s) => !acceptingSuggestionIds.has(s.id))
    : suggestions

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
  }, [effectiveMode])

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

  // Server-backed pending suggestions — the population Accept all covers.
  const pendingSuggestionCount = visibleSuggestions.filter((s) => s.id > 0).length

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

  const documentStyle = {
    ...(documentWidth === null ? {} : { '--document-width': `${documentWidth}px` }),
    ...(richContentWidth === null ? {} : { '--rich-content-width': `${richContentWidth}px` }),
  } as CSSProperties

  return (
    <>
      <Head title={documentTitle} />
      <div
        className={`doc-page ${panelOpen ? '' : 'is-panel-hidden'} ${isReading ? 'is-read-mode' : ''}`}
        style={Object.keys(documentStyle).length === 0 ? undefined : documentStyle}
      >
        <header className="doc-header">
          <div className="doc-header-left">
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
            {/* ≤3 groups: identity/presence · Share · ⋯ menu */}
            <div className="doc-header-people">
              <IdentityChip
                identity={identity}
                guest={guest}
                authenticated={Boolean(viewer.account)}
                onRenamed={handleRenamed}
              />
              {!isReading && <ProvenanceSummaryChip spans={spans} />}
              <PresenceBar
                humans={peers}
                agents={presences}
                compact={isMobile}
                followingClientId={followingClientId}
                onFollow={(clientId) => {
                  setFollowingClientId((current) => current === clientId ? null : clientId)
                }}
              />
            </div>
            {!isReading && pendingSuggestionCount > 1 && (
              <button
                className="accept-all-button"
                disabled={acceptingAll}
                onClick={() => void acceptAllSuggestions()}
              >
                {acceptingAll ? 'Accepting…' : `Accept all ${pendingSuggestionCount}`}
              </button>
            )}
            <SharePopover
              agentsActive={presences.length}
              exportReady={Boolean(handle)}
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
              {/* Instant first paint: server-rendered prose fills the reserved
                  editor frame and holds the layout height. The live editor sits
                  on top of it (transparent) while Milkdown boots, so its synced
                  content paints over the identical preview — then the preview is
                  dropped a couple frames later. The preview is always behind the
                  editor until then, so content is never momentarily blank. */}
              <div
                className="doc-editor-stack"
                data-phase={editorSwapped ? 'live' : handle ? 'revealing' : 'booting'}
              >
                {!editorSwapped && doc.content_html && (
                  <div className="doc-static-preview milkdown" aria-hidden="true">
                    <div
                      className="ProseMirror"
                      dangerouslySetInnerHTML={{ __html: doc.content_html }}
                    />
                  </div>
                )}
                {/* The editor is a client-only island: Milkdown/ProseMirror,
                    Yjs, the ActionCable provider, and Excalidraw never render
                    on the server. The server emits an empty doc-live-editor
                    shell (identical on the client's first hydration render) and
                    the static preview above carries first paint until the
                    editor mounts post-hydration and the swap takes over. */}
                <div className="doc-live-editor">
                  {isClient && (
                    <DocumentEditor
                      key={editorSessionKey}
                      slug={doc.slug}
                      identity={identity}
                      canWrite={ownership.can_write}
                      connectionIdentity={connectionIdentity}
                      contentFormat={doc.content_format}
                      initialStateB64={doc.yjs_state_b64}
                      seedContent={doc.seed_content}
                      seedVersion={doc.seed_version}
                      seedGranted={doc.seed_granted}
                      seedAuthorKind={doc.seed_author_kind}
                      seedAuthorName={doc.seed_author_name}
                      editable={ownership.can_write && (effectiveMode === 'edit' || effectiveMode === 'suggest')}
                      suggesting={ownership.can_write && effectiveMode === 'suggest'}
                      taskInteractive={ownership.can_write && effectiveMode !== 'comment'}
                      onReady={(h) => {
                        setReadyEditor({ key: editorSessionKey, handle: h })
                        // Wait two frames so ProseMirror has painted the synced
                        // content before the preview is removed.
                        requestAnimationFrame(() =>
                          requestAnimationFrame(() =>
                            setSwappedEditorKey(editorSessionKey),
                          ),
                        )
                      }}
                      onStatus={setStatus}
                      onSpans={setSpans}
                      onSelection={isReading ? undefined : handleSelection}
                      onTitleChange={setDocumentTitle}
                    />
                  )}
                </div>
              </div>
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
                <MarginInlineSuggestions
                  inline={inlineSuggestions}
                  handle={handle}
                  spans={spans}
                  focusMode={focusMode || isMobile}
                />
                <MarginSuggestions
                  suggestions={visibleSuggestions}
                  handle={handle}
                  spans={spans}
                  focusMode={focusMode || isMobile}
                  contentFormat={doc.content_format}
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
              <ActivityPanel activities={activities} />
            </aside>
          )}
        </main>
        {!isReading && selectionTarget && selectionToolbarActive && (
          <SelectionToolbar
            rootRef={selectionPopover.ref}
            position={selectionPopover.position}
            actions={[
              {
                label: 'Comment',
                onClick: () => {
                  setComposerAnchor(selectionTarget.text)
                  setSelectionTarget(null)
                },
              },
            ]}
          />
        )}
        {!isReading && commentTarget && commentAffordanceActive && (
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
            suggestionCount={visibleSuggestions.length + inlineSuggestions.length}
            commentCount={comments.filter((c) => !c.resolved).length}
            active={activeSheet}
            onOpen={(kind) => setActiveSheet((current) => (current === kind ? null : kind))}
          />
        )}
        {!isReading && isMobile && activeSheet === 'suggestions' && (
          <MobileSheet
            title={`Suggestions${visibleSuggestions.length + inlineSuggestions.length > 0 ? ` · ${visibleSuggestions.length + inlineSuggestions.length}` : ''}`}
            onClose={() => {
              setActiveSheet(null)
              setSheetFocusId(null)
            }}
          >
            <InlineSuggestionSheetList inline={inlineSuggestions} handle={handle} />
            <SuggestionSheetList
              suggestions={visibleSuggestions}
              focusId={sheetFocusId}
              onAccept={acceptSuggestion}
              onReject={rejectSuggestion}
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
              onCancelComposer={() => setComposerAnchor(null)}
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
