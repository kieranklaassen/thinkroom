import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Head } from '@inertiajs/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { ProvenanceSpan } from '../../editor/provenance'
import type { ConnectionStatus, EditorHandle } from '../../editor/milkdown_editor'
import type { DocumentFormat } from '../../editor/document_format'
import type { RenderHints } from '../../editor/cable_provider'
import { UnsavedEditNotice } from '../../components/unsaved_edit_notice'
import { bindReadModeCopy } from '../../editor/clipboard'
import { bindReadPointerBroadcast } from '../../editor/read_pointers'
import { downloadDocumentHtml, downloadDocumentMarkdown } from '../../editor/document_export'
import { ProvenanceSummaryChip } from '../../components/provenance_summary'
import { HighlightLegendPanel } from '../../components/highlight_legend_panel'
import { ReviewPopover } from '../../components/review_popover'
import { MarginAnnotations } from '../../components/margin_annotations'
import type { FindingCardsSource } from '../../components/finding_margin_cards'
import { CompoundPanel } from '../../components/compound_panel'
import { CommentsPanel } from '../../components/comments_panel'
import { AnchoredComposer } from '../../components/anchored_composer'
import { SelectionToolbar } from '../../components/selection_toolbar'
import { ActivityPanel, type ActivityFilter } from '../../components/activity_panel'
import { ClaimBanner } from '../../components/claim_banner'
import type { EditorMode } from '../../components/mode_control'
import type { ThemeName } from '../../lib/theme'
import { CommentRecovery } from '../../components/comment_recovery'
import { DocumentHeader } from '../../components/document_header'
import { VersionUpdateButton } from '../../components/version_update_button'
import { DocumentWidthHandle } from '../../components/document_width_handle'
import { MobileDock, MobileSheet, SuggestionSheetList } from '../../components/mobile_dock'
import { useDocumentAppearance } from './use_document_appearance'
import { useDocumentMode, useReadModeFallback } from './use_document_mode'
import { useDocumentTick } from './use_document_tick'
import { useDocumentWebmcp } from './use_document_webmcp'
import { useMobileSheets } from './use_mobile_sheets'
import { usePanelPreferences } from './use_panel_preferences'
import { useDocumentShortcuts } from './use_document_shortcuts'
import { useEditorPresence } from './use_editor_presence'
import { useDocumentChannel } from './use_document_channel'
import { useReviewHighlight, useTextTargeting } from './use_text_targeting'
import { useSuggestionReview } from './use_suggestion_review'
import { useDocumentIdentity } from './use_document_identity'
import { useFollowPresence } from './use_follow_presence'
import { useComments } from './use_comments'
import { useCommentAnchors } from './use_comment_anchors'
import { useCompoundReview } from './use_compound_review'
import { useHighlighter } from './use_highlighter'
import { useFloatingChrome, type TextTarget } from './use_floating_chrome'
import { NativeDocBridge } from './native_doc_bridge'
import { StagedDocumentEditor } from './staged_document_editor'
import { useIsClient } from '../../lib/use_is_client'
import type { WebmcpManifest } from '../../lib/webmcp'
import type { SharedProps } from '../../types'
import type { ViewerPayload } from '../../types/viewer'
import type {
  ActivityPayload,
  AgentPresencePayload,
  CollaboratorKind,
  CommentPayload,
  OwnershipPayload,
  SuggestionPayload,
  WritingPackPayload,
  WritingPassPayload,
  WritingReviewerPayload,
} from '../../types/payloads'
import { setCookie } from '../../lib/cookies'
import { ThemePicker } from '../../components/theme_picker'
import './show.css'

export interface DocumentProps {
  document: {
    id: number
    slug: string
    title: string
    content_format: DocumentFormat
    content_generation: number
    seed_content: string | null
    seed_version: string
    seed_granted: boolean
    seed_claim: string | null
    seed_author_kind: CollaboratorKind | null
    seed_author_name: string | null
    has_state: boolean
    yjs_state_b64: string | null
    yjs_state_checksum: string | null
    content_html: string
    content_blocks: number
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
    theme: ThemeName
    panel_open: boolean
    focus_mode: boolean
    activity_filter: ActivityFilter
    activity_expanded: boolean
    comments_resolved: boolean
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
  /** Compound writing (Comment mode) exists only for accounts holding the
   *  feature; the other writing_* props ride only when this is true. */
  writing_available: boolean
  writing_enabled?: boolean
  /** The account's enabled lenses across its packs. */
  writing_reviewers?: WritingReviewerPayload[]
  writing_packs?: WritingPackPayload[]
  /** Optional outside Comment mode (undefined until fetched); null when the
   *  document has never been reviewed. */
  writing_pass?: WritingPassPayload | null
  // WebMCP tool manifest (AgentGuide.webmcp_tools) — lazy prop, registered on
  // document.modelContext once per slug after hydration.
  webmcp: WebmcpManifest
  nativeApp: SharedProps['nativeApp']
}

const EMPTY_REVIEWERS: WritingReviewerPayload[] = []
const EMPTY_PACKS: WritingPackPayload[] = []

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
  writing_available: writingAvailable,
  writing_enabled: writingEnabled = false,
  writing_reviewers: writingReviewers = EMPTY_REVIEWERS,
  writing_packs: writingPacks = EMPTY_PACKS,
  writing_pass: writingPass,
  webmcp,
  nativeApp,
}: DocumentProps) {
  // SSR/hydration island flag: the live editor and any render-time browser
  // reads are gated on this so the server (and the client's first hydration
  // render) produce identical markup. It flips true on the next client commit.
  const isClient = useIsClient()

  const { identity, guest, handleRenamed } = useDocumentIdentity(viewer)
  // Optimistic: a hydrated or freshly-seeded doc is functionally live the
  // moment it paints — the websocket only confirms it. Starting at 'live'
  // avoids the connecting→live dot flash on every load. A document whose
  // state was too large to embed really is waiting on the handshake.
  const [status, setStatus] = useState<ConnectionStatus>(
    doc.yjs_state_b64 || doc.seed_granted ? 'live' : 'connecting',
  )
  // Server-derived first-H1 title so the header reads correctly on first paint;
  // the editor keeps it live via onTitleChange once it mounts.
  const [documentTitle, setDocumentTitle] = useState(doc.display_title || doc.title)
  // The staged (image-settled) editor handle, reported by StagedDocumentEditor.
  const [handle, setHandle] = useState<EditorHandle | null>(null)
  const [spans, setSpans] = useState<ProvenanceSpan[]>([])
  // Whichever text-anchored floating affordance is open (selection toolbar,
  // click-to-comment, AI review) — one cell, structurally mutually exclusive.
  const [textTarget, setTextTarget] = useState<TextTarget | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Editor-originated notices (refused oversized edit, snapshot refused as
  // too large); share the doc-notice slot with suggestion notices.
  const [editorNotice, setEditorNotice] = useState<string | null>(null)
  const [unsavedEdit, setUnsavedEdit] = useState(false)
  const { theme, changeTheme, documentWidth, setDocumentWidth, pageStyle } =
    useDocumentAppearance(ui)
  const { availableModes, effectiveMode, demoModeLocked, modeLocked, isReading, changeMode } =
    useDocumentMode({
      slug: doc.slug,
      urlMode: ui.mode,
      canWrite: ownership.can_write,
      canComment: ownership.can_comment,
    })
  // Compound writing rides inside Comment mode for featured accounts.
  const showCompound = effectiveMode === 'comment' && writingAvailable
  const connectionIdentity = viewer.account ? `account:${viewer.account.id}` : 'guest'
  const editorSessionKey = `${doc.slug}:${ownership.can_write ? 'write' : 'read'}`
  // Live handle for code that runs after awaits or inside stable callbacks —
  // a closure-captured handle goes stale when the editor remounts mid-flight.
  const handleRef = useRef<EditorHandle | null>(null)
  handleRef.current = handle

  const docTick = useDocumentTick(handle)

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

  const {
    reloadPass,
    visibleFindingCount,
    findingCards: findingCardsBase,
    panelProps: compoundPanelProps,
  } = useCompoundReview({
    slug: doc.slug,
    pass: writingPass,
    reviewers: writingReviewers,
    packs: writingPacks,
    active: showCompound,
    enabled: writingEnabled,
    canWrite: ownership.can_write,
    handle,
    identityName: identity.name,
    docTick,
  })

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
  // Stable callbacks read the live mode and ownership through these.
  const modeRef = useRef(effectiveMode)
  modeRef.current = effectiveMode
  const ownershipRef = useRef(ownership)
  ownershipRef.current = ownership
  useDocumentWebmcp({
    slug: doc.slug,
    contentFormat: doc.content_format,
    webmcp,
    handleRef,
    modeRef,
    ownershipRef,
  })
  // Leaving Comment mode dismisses any pending click-to-comment affordance.
  useEffect(() => {
    if (effectiveMode !== 'comment') {
      setTextTarget((target) => (target?.kind === 'comment' ? null : target))
    }
  }, [effectiveMode])

  const {
    isMobile,
    activeSheet,
    setActiveSheet,
    toggleSheet,
    closeSheet,
    sheetFocusKey,
    setSheetFocusKey,
    openSuggestionSheet,
  } = useMobileSheets(isClient)

  // Read mode has no text-targeted or review actions. Clear anything opened
  // in another mode so switching always lands on a clean document view.
  // (The composer clears itself on any mode switch — see useComments.)
  useEffect(() => {
    if (!isReading) return
    setTextTarget(null)
    setSuggestionNotice(null)
    setActiveSheet(null)
  }, [isReading, setActiveSheet, setSuggestionNotice])

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

  const {
    panelOpen,
    togglePanel,
    focusMode,
    setFocusMode,
    toggleFocus,
    commentsResolved,
    changeCommentsResolved,
    activityPreferences,
  } = usePanelPreferences(ui)

  useReadModeFallback({ slug: doc.slug, urlMode: ui.mode, availableModes, demoModeLocked })
  useDocumentShortcuts({
    theme,
    changeTheme,
    availableModes,
    modeLocked,
    changeMode,
    togglePanel,
    toggleFocus,
  })

  const presencePoll = useEditorPresence(handle, identity, presences)
  const { newVersionAvailable, onDocumentGone, reloadChangedAccess, reloadAfterContentReset } =
    useDocumentChannel({
      slug: doc.slug,
      handle,
      yours: ownership.yours,
      connectionIdentity,
      presencePoll,
      onTitle: setDocumentTitle,
      onWritingPass: reloadPass,
    })

  const { reviewNotice, handleSelection, closeReview, navigateProvenance, handleAdvance } =
    useTextTargeting({
      viewRef,
      handleRef,
      modeRef,
      ownershipRef,
      textTarget,
      setTextTarget,
      reviewItems,
      isMobile,
      openSuggestionSheet,
    })

  const {
    failedComment, retryFailedComment, checkFailedComment, dismissFailedComment,
    checkingComment, commentNotice, clearCommentNotice, resolvingComments,
    composerAnchor,
    composerOpen,
    getComposerRange,
    openComposer,
    closeComposer,
    cancelComposer,
    submitComment,
    submitAnchoredComment,
    resolveComment,
  } = useComments({
    comments,
    canComment: ownership.can_comment,
    slug: doc.slug,
    identityName: identity.name,
    viewRef,
    effectiveMode,
    isMobile,
    docTick,
  })

  // Rail cards ↔ document text: every open anchor stays tinted in Comment
  // mode, and hovering/clicking a card highlights/jumps to its text.
  const { anchoredIds, anchorRanges, hoverAnchor, jumpToComment } = useCommentAnchors({
    comments,
    handle,
    docTick,
    tintAll: effectiveMode === 'comment',
  })

  const marginComments = useMemo(() => comments.filter((comment) => !comment.resolved && anchorRanges.has(comment.id)), [comments, anchorRanges])

  // ⌘\ hides the rail with CSS while the panel stays mounted, so a card
  // hovered at that moment never gets its mouseleave — drop the spotlight.
  useEffect(() => {
    if (!panelOpen) hoverAnchor(null)
  }, [panelOpen, hoverAnchor])

  // The comment composer lives in the comments panel — on mobile that means
  // opening its sheet when a selection chooses "Comment".
  useEffect(() => {
    if (isMobile && composerAnchor !== null) setActiveSheet('comments')
  }, [isMobile, composerAnchor, setActiveSheet])

  const { highlightGroups, highlightSwatches, jumpToHighlight } = useHighlighter({
    handle,
    viewRef,
    docTick,
    textTarget,
    names: highlightNames,
    canWrite: ownership.can_write,
    effectiveMode,
  })

  // One floating form at a time: an open composer suppresses the selection
  // chrome, as do share and theme popovers (z-60, above chrome's z-50).
  const [shareOpen, setShareOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)

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
    getComposerRange,
    chromeSuppressed: composerOpen || shareOpen || themeOpen,
    spans,
    docTick,
    isMobile,
  })

  useReviewHighlight({ viewRef, textTarget, reviewActive, liveReviewSpan, docTick, closeReview })

  // A marker tap opens the page's own sheet, so that one handler joins the
  // cards here. The object identity is a remeasure signal (see useCompoundReview).
  const findingCards = useMemo<FindingCardsSource>(() => ({
    ...findingCardsBase,
    onMarkerSelect: isMobile ? () => setActiveSheet('reviewers') : undefined,
  }), [findingCardsBase, isMobile, setActiveSheet])

  const exportReady = Boolean(handle)
  const provenanceSummary = (
    <ProvenanceSummaryChip spans={spans} ready={exportReady} onNavigate={navigateProvenance} />
  )
  const commentAction = (label: string, text: string) => ({
    label,
    onClick: () => {
      openComposer(text)
      setTextTarget(null)
    },
  })
  const commentsPanelProps = {
    showResolved: commentsResolved,
    onShowResolvedChange: changeCommentsResolved,
    resolvingComments,
    comments,
    anchoredIds,
    onSubmit: submitComment,
    onResolve: resolveComment,
  }
  const activityProps = { activities, ...activityPreferences }

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
        onToggleActivity={() => toggleSheet('activity')}
        onOpenTheme={() => setActiveSheet('theme')}
        exportReady={exportReady}
        onExportMarkdown={exportMarkdown}
        onExportHtml={exportHtml}
      />
      <div
        className={`doc-page ${panelOpen ? '' : 'is-panel-hidden'} ${isReading ? 'is-read-mode' : ''}`}
        style={pageStyle}
      >
        {/* The update prompt normally lives in the (native-hidden) header; it
            is the only trigger for reloading an owner-reset or newly deployed
            document, so in the app it floats on its own. */}
        {nativeApp && newVersionAvailable && (
          <VersionUpdateButton className="version-update version-update--native" />
        )}
        <DocumentHeader
          documentTitle={documentTitle}
          effectiveMode={effectiveMode}
          availableModes={availableModes}
          modeLocked={modeLocked}
          demoModeLocked={demoModeLocked}
          onChangeMode={changeMode}
          status={status}
          newVersionAvailable={newVersionAvailable}
          peers={peers}
          presences={presences}
          isMobile={isMobile}
          followingClientId={followingClientId}
          onFollow={toggleFollow}
          provenanceSummary={!isReading && provenanceSummary}
          identity={identity}
          guest={guest}
          viewer={viewer}
          onRenamed={handleRenamed}
          acceptAllCount={isReading ? 0 : pendingSuggestionCount}
          acceptingAll={acceptingAll}
          onAcceptAll={acceptAllSuggestions}
          ownership={ownership}
          exportReady={exportReady}
          onExportMarkdown={exportMarkdown}
          onExportHtml={exportHtml}
          onShareOpenChange={setShareOpen}
          theme={theme}
          onChangeTheme={changeTheme}
          onThemeOpenChange={setThemeOpen}
          panelOpen={panelOpen}
          onTogglePanel={togglePanel}
          focusMode={focusMode}
          onToggleFocus={toggleFocus}
          slug={doc.slug}
        />
        {!isReading && (
          <ClaimBanner slug={doc.slug} ownership={ownership} claimerName={identity.name} />
        )}
        <UnsavedEditNotice unsaved={unsavedEdit} />
        {!isReading && (suggestionNotice || editorNotice) && (
          <div className="doc-notice" role="status">
            <span>{suggestionNotice ?? editorNotice}</span>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => {
                setSuggestionNotice(null)
                setEditorNotice(null)
              }}
            >
              Dismiss
            </button>
          </div>
        )}
        {(failedComment || commentNotice) && (
          <CommentRecovery
            failedComment={failedComment}
            retryFailedComment={retryFailedComment}
            checkFailedComment={checkFailedComment}
            dismissFailedComment={dismissFailedComment}
            checkingComment={checkingComment}
            commentNotice={commentNotice}
            clearCommentNotice={clearCommentNotice}
            viewRef={viewRef}
            canComment={ownership.can_comment}
          />
        )}
        {!isReading && <div className={`prov-summary-compact ${nativeApp ? 'is-native' : ''}`}>
          {provenanceSummary}
        </div>}
        {!isReading && <div className="review-notice" role="status" aria-live="polite">{reviewNotice}</div>}
        <main className="doc-body">
          <div className={`doc-canvas ${focusMode ? 'is-focus' : ''}`}>
            <article className="doc-main">
              {/* Keyed on the permission-scoped session: a permission flip
                  remounts the whole stage, so a delayed callback from the old
                  editor can never hide the preview for a new remount. */}
              <StagedDocumentEditor
                key={editorSessionKey}
                contentHtml={doc.content_html}
                contentBlocks={doc.content_blocks}
                isClient={isClient}
                onHandle={setHandle}
                slug={doc.slug}
                identity={identity}
                canWrite={ownership.can_write}
                connectionIdentity={connectionIdentity}
                contentFormat={doc.content_format}
                contentGeneration={doc.content_generation}
                initialStateB64={doc.yjs_state_b64}
                initialStateChecksum={doc.yjs_state_checksum}
                renderHints={doc.render_hints}
                seedContent={doc.seed_content}
                seedVersion={doc.seed_version}
                seedGranted={doc.seed_granted}
                seedClaim={doc.seed_claim}
                seedAuthorKind={doc.seed_author_kind}
                seedAuthorName={doc.seed_author_name}
                editable={ownership.can_write && (effectiveMode === 'edit' || effectiveMode === 'suggest')}
                suggesting={ownership.can_write && effectiveMode === 'suggest'}
                taskInteractive={ownership.can_write && effectiveMode !== 'comment'}
                onStatus={setStatus}
                onSpans={setSpans}
                onSelection={isReading ? undefined : handleSelection}
                onTitleChange={setDocumentTitle}
                // This tab's local doc predates an owner CLI replacement (a frame
                // it sent, or its resubscription, was rejected for staleness, or
                // a handshake reported a different generation), a claimant's
                // seed was refused or superseded because other content is
                // stored, or a viewer's local copy of the seed was superseded by
                // real state. Same recovery action as content_reset, reached via
                // the sync channel or a refused durable save of the seed.
                onStale={reloadAfterContentReset}
                onAccessChanged={reloadChangedAccess}
                // The sync channel rejects its resubscription when the doc is
                // gone; same exit path as the deleted broadcast.
                onRejected={onDocumentGone}
                onNotice={setEditorNotice}
                onUnsavedEdit={setUnsavedEdit}
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
                <MarginAnnotations
                  findings={showCompound ? findingCards : undefined}
                  comments={marginComments}
                  anchorRanges={anchorRanges}
                  onResolveComment={resolveComment}
                  resolvingComments={resolvingComments}
                  onJumpToComment={jumpToComment}
                  onHoverComment={hoverAnchor}
                  onCommentMarkerSelect={(comment) => {
                    if (isMobile) setActiveSheet('comments')
                    else { setFocusMode(false); jumpToComment(comment) }
                  }}
                  items={reviewItems}
                  handle={handle}
                  focusMode={focusMode || isMobile}
                  onMarkerSelect={isMobile ? (item) => openSuggestionSheet(item.key) : undefined}
                />
              </div>
            )}
          </div>
          {!isMobile && (!isReading || highlightGroups.length > 0) && (
            <aside className="doc-rail">
              {showCompound && <CompoundPanel {...compoundPanelProps} />}
              {!isReading && (
                <CommentsPanel
                  {...commentsPanelProps}
                  marginIds={focusMode ? null : anchoredIds}
                  // The desktop composer is the anchored card next to the
                  // selection — the rail keeps the list only.
                  composerAnchor={null}
                  onCancelComposer={closeComposer}
                  onJumpTo={jumpToComment}
                  onHover={hoverAnchor}
                />
              )}
              {/* The legend is part of reading the document — colors only
                  mean something with their names — so Read mode keeps it
                  (names locked, snippets still jump) while the review
                  panels stay Edit/Suggest/Comment-only. */}
              <HighlightLegendPanel
                groups={highlightGroups}
                names={highlightNames}
                canWrite={ownership.can_write && !isReading}
                slug={doc.slug}
                onJumpTo={jumpToHighlight}
              />
              {!isReading && <ActivityPanel {...activityProps} />}
            </aside>
          )}
        </main>
        {!isReading && textTarget?.kind === 'selection' && selectionToolbarActive && (
          <SelectionToolbar
            rootRef={selectionPopover.ref}
            position={selectionPopover.position}
            actions={[commentAction('Comment', textTarget.text)]}
            swatches={highlightSwatches}
          />
        )}
        {!isReading && textTarget?.kind === 'comment' && commentAffordanceActive && (
          <SelectionToolbar
            rootRef={commentAffordance.ref}
            position={commentAffordance.position}
            actions={[commentAction('Comment on this paragraph', textTarget.text)]}
          />
        )}
        {!isReading && liveReviewSpan && reviewActive && (
          <ReviewPopover
            rootRef={reviewPopover.ref}
            span={liveReviewSpan}
            position={reviewPopover.position}
            onAdvance={handleAdvance}
            canReview={effectiveMode === 'edit' && ownership.can_write}
            focusRequest={textTarget?.kind === 'review' && textTarget.keyboard ? textTarget.target : null}
            onClose={closeReview}
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
            reviewerFindingCount={showCompound ? visibleFindingCount : undefined}
            active={activeSheet}
            onOpen={toggleSheet}
          />
        )}
        {showCompound && isMobile && activeSheet === 'reviewers' && (
          <MobileSheet title="Reviewers" onClose={closeSheet}>
            <CompoundPanel
              {...compoundPanelProps}
              onJumpTo={(finding) => {
                compoundPanelProps.onJumpTo(finding)
                closeSheet()
              }}
            />
          </MobileSheet>
        )}
        {!isReading && isMobile && activeSheet === 'suggestions' && (
          <MobileSheet
            title={`Suggestions${reviewItems.length > 0 ? ` · ${reviewItems.length}` : ''}`}
            onClose={() => {
              closeSheet()
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
          <MobileSheet title="Comments" onClose={closeSheet}>
            <CommentsPanel
              {...commentsPanelProps}
              composerAnchor={composerAnchor}
              onCancelComposer={cancelComposer}
              onJumpTo={(comment) => {
                jumpToComment(comment)
                closeSheet()
              }}
            />
          </MobileSheet>
        )}
        {!isReading && isMobile && activeSheet === 'activity' && (
          <MobileSheet title="Activity" onClose={closeSheet}>
            <ActivityPanel {...activityProps} />
          </MobileSheet>
        )}
        {activeSheet === 'theme' && (
          <MobileSheet title="Document theme" onClose={closeSheet}>
            <ThemePicker theme={theme} onChange={changeTheme} autoFocus />
          </MobileSheet>
        )}
      </div>
    </>
  )
}
