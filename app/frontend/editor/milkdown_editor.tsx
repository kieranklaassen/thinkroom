import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { listenerCtx } from '@milkdown/kit/plugin/listener'
// Base ProseMirror styles the table-block chrome depends on: a positioned
// .ProseMirror ancestor and the prosemirror-tables fixed-layout/selection CSS.
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import './table_block.css'
import './frontmatter/frontmatter.css'
import { collabServiceCtx } from '@milkdown/plugin-collab'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { CableProvider, RenderHints } from './cable_provider'
import {
  acquireSession,
  markSeedApplied,
  releaseSession,
  seedAlreadyApplied,
} from './collab_session'
import { createChangeReporter } from './change_reporting'
import { gatedCursorAwareness } from './cursor_awareness'
import type { DocumentFormat } from './document_format'
import { assembleEditor } from './editor_assembly'
import type { UserIdentity } from './identity'
import { bindMermaidHintPersistence } from './mermaid'
import type { ProvenanceSpan } from './provenance'
import { readPointerAwarenessCtx } from './read_pointers'
import { connectWithSeed } from './seed_application'
import { selectionCallbackCtx, type SelectionCallback } from './selection_watcher'
import type { SketchControls } from './sketch/node_view'
import { useSketchEditing } from './sketch/use_sketch_editing'
import { buildSnapshotPayload, createSnapshotScheduler } from './snapshots'
import {
  enableSuggestChanges,
  disableSuggestChanges,
} from '@handlewithcare/prosemirror-suggest-changes'
import { taskPersistenceCtx } from './task_list_items'
import type { CollaboratorKind } from '../types/payloads'

export interface EditorHandle {
  editor: Editor
  ydoc: Y.Doc
  provider: CableProvider
}

export type ConnectionStatus = 'connecting' | 'live'

export interface EditorProps {
  slug: string
  identity: UserIdentity
  contentFormat: DocumentFormat
  /** Server-known Document#content_generation at page render time, so
   *  CableProvider carries the current generation from first paint (including
   *  early keepalive flushes before the WebSocket sync handshake completes). */
  contentGeneration?: number
  /** Server-rendered Yjs state (base64) — hydrates the doc before the
   *  provider syncs, so the first paint is already populated. */
  initialStateB64?: string | null
  /** SHA-256 checksum matching initialStateB64, enabling a 0-byte handshake
   *  when the document has not changed between HTML render and WebSocket join. */
  initialStateChecksum?: string | null
  /** Seed template for a never-edited document. Applied at bind time when
   *  the page response granted this client the seed claim. */
  seedContent?: string | null
  /** Changes whenever the server-side source generation changes. */
  seedVersion?: string | null
  /** True when documents#show atomically claimed the seed for this page
   *  load — the props-first path that skips the WebSocket round-trip. */
  seedGranted?: boolean
  /** Identifies that grant; returned with the first seed write. */
  seedClaim?: string | null
  /** Who authored the seed source. Non-human seeds get their text
   *  explicitly AI-attributed after the collab connection renders them —
   *  otherwise seeded text is unmarked and counts as human in the
   *  provenance summary. */
  seedAuthorKind?: CollaboratorKind | null
  seedAuthorName?: string | null
  /** Read-only gate for Comment mode. Implemented EXCLUSIVELY as
   *  ProseMirror `editable: () => false` — provider connection, Yjs sync,
   *  agent edits, programmatic dispatch, and seed application stay
   *  mode-independent (a restored read-only mode must never burn the seed
   *  claim). Defaults to editable. */
  editable?: boolean
  /** Server-authorized capability. Unlike `editable`, this gates every
   * outgoing CRDT frame and durable snapshot while preserving inbound sync. */
  canWrite?: boolean
  /** Coarse server-known identity used to refresh Action Cable after auth changes. */
  connectionIdentity?: string
  /** Suggest mode: typing is intercepted into tracked insertion/deletion
   *  marks. Synced into the suggest-changes plugin state only after the
   *  editor has started — seeding and initial sync always run with
   *  suggesting off, so a pre-stored suggest mode can never wrap the seed
   *  template into suggestion marks. */
  suggesting?: boolean
  /** Task controls can remain interactive while text editing is disabled,
   *  as in Read mode. Defaults to the text editability setting. */
  taskInteractive?: boolean
  /** Persisted render geometry from documents#show (currently Mermaid figure
   *  heights) so async renderers reserve their final space up front — the
   *  same hints size the server preview's skeletons. */
  renderHints?: RenderHints
  onReady?: (handle: EditorHandle) => void
  onStatus?: (status: ConnectionStatus) => void
  onSpans?: (spans: ProvenanceSpan[]) => void
  onSelection?: SelectionCallback
  onTitleChange?: (title: string) => void
  /** The local doc no longer matches the server's and must be reloaded. */
  onStale?: () => void
  /** A page still waiting for content has other access than it was rendered with. */
  onAccessChanged?: () => void
  /** The document no longer exists on the server. */
  onRejected?: () => void
  /** User-facing notices the editor cannot render itself: an edit refused
   *  for pushing the document past its size limit, a durable snapshot the
   *  server refused as too large. */
  onNotice?: (message: string) => void
  /** Whether this session holds an edit too large to save. */
  onUnsavedEdit?: (unsaved: boolean) => void
}

const REFUSED_EDIT_NOTICE =
  'That edit was not applied: it would push this document past its 2 MB limit.'
const SNAPSHOT_TOO_LARGE_NOTICE =
  'This document is over the 2 MB source limit, so its saved copy is stale. Shorten it to keep agents and previews current.'

// Sync the Suggest-mode flag into the suggest-changes plugin state. Safe to
// call before the view mounts — start() applies the current value then.
function syncSuggesting(editor: Editor, suggesting: boolean): void {
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (suggesting) enableSuggestChanges(view.state, view.dispatch)
      else disableSuggestChanges(view.state, view.dispatch)
    })
  } catch {
    // view not mounted yet
  }
}

function CollabEditor({
  slug,
  identity,
  contentFormat,
  contentGeneration,
  initialStateB64,
  initialStateChecksum,
  seedContent,
  seedVersion,
  seedGranted,
  seedClaim,
  seedAuthorKind,
  seedAuthorName,
  canWrite = true,
  connectionIdentity = 'guest',
  editable = true,
  suggesting = false,
  taskInteractive = editable,
  renderHints,
  onReady,
  onStatus,
  onSpans,
  onSelection,
  onTitleChange,
  onStale,
  onAccessChanged,
  onRejected,
  onNotice,
  onUnsavedEdit,
}: EditorProps) {
  const callbacksRef = useRef({ onReady, onStatus, onSpans, onSelection, onTitleChange, onStale, onAccessChanged, onRejected, onNotice, onUnsavedEdit })
  callbacksRef.current = { onReady, onStatus, onSpans, onSelection, onTitleChange, onStale, onAccessChanged, onRejected, onNotice, onUnsavedEdit }
  // Ref so the editable() closure always reads the live value; the effect
  // below nudges ProseMirror to re-read it when the mode changes.
  const editableRef = useRef(editable)
  editableRef.current = editable
  const suggestingRef = useRef(suggesting)
  suggestingRef.current = suggesting
  const taskInteractiveRef = useRef(taskInteractive)
  taskInteractiveRef.current = taskInteractive
  const canWriteRef = useRef(canWrite)
  canWriteRef.current = canWrite
  const sketchControlsRef = useRef<SketchControls>(null)
  // Suggesting only syncs into plugin state after start() — the gate that
  // keeps seed/initial-sync transactions out of the dispatch transform.
  const startedRef = useRef(false)

  const { get, loading } = useEditor(
    (root) =>
      assembleEditor({
        root,
        authorName: identity.name,
        mermaidHints: renderHints?.mermaid,
        editable: () => editableRef.current,
        // Filled by useSketchEditing below, before Milkdown runs this factory.
        sketchControls: () => sketchControlsRef.current!,
        onEditRefused: () => callbacksRef.current.onNotice?.(REFUSED_EDIT_NOTICE),
      }),
    [],
  )

  useEffect(() => {
    if (loading) return
    const editor = get()
    if (!editor) return

    const { ydoc, provider } = acquireSession(
      slug,
      identity,
      canWriteRef.current,
      connectionIdentity,
      initialStateB64,
      initialStateChecksum,
      contentGeneration,
    )
    callbacksRef.current.onStatus?.('connecting')
    // Bound before the editor is ready: a client still waiting for content has
    // no handle to report through.
    const stale = () => callbacksRef.current.onStale?.()
    const accessChanged = () => callbacksRef.current.onAccessChanged?.()
    const rejected = () => callbacksRef.current.onRejected?.()
    const unsavedEdit = () => callbacksRef.current.onUnsavedEdit?.(provider.unsavedEdit)
    provider.on('stale', stale)
    provider.on('access-changed', accessChanged)
    provider.on('rejected', rejected)
    provider.on('unsaved-edit', unsavedEdit)
    unsavedEdit()
    // Discarded while no editor was listening (a remount reusing the session).
    if (provider.discarded) stale()

    let cancelled = false
    let unbindMermaidHints: (() => void) | null = null
    const reporter = createChangeReporter(() => callbacksRef.current)
    const snapshots = createSnapshotScheduler({
      editor,
      ydoc,
      slug,
      contentFormat,
      canWrite: () => canWriteRef.current,
      onTooLarge: () => callbacksRef.current.onNotice?.(SNAPSHOT_TOO_LARGE_NOTICE),
    })
    const scheduleSnapshot = snapshots.schedule

    let started = false
    const start = () => {
      if (started || cancelled) return
      started = true
      editor.action((ctx) => {
        const service = ctx.get(collabServiceCtx)
        ctx.set(readPointerAwarenessCtx.key, provider.awareness)
        // The service's awareness feeds ONLY y-prosemirror's cursor plugin,
        // whose per-tick dispatches stomp native selections in non-editable
        // modes — hand it the gated façade so it re-renders only when the
        // remote cursor slice actually changed. Sync (bindDoc) is unaffected.
        service.bindDoc(ydoc).setAwareness(gatedCursorAwareness(provider.awareness))
        ctx.set(taskPersistenceCtx.key, {
          persist: () =>
            provider.persistCurrentState(buildSnapshotPayload(ctx, ydoc, contentFormat)),
          enabled: () => taskInteractiveRef.current,
        })
        connectWithSeed(ctx, ydoc, provider, contentFormat, reporter.reportSpans)

        const view = ctx.get(editorViewCtx)
        ctx.set(selectionCallbackCtx.key, { fn: reporter.reportSelection })
        reporter.reportSpans(view)

        ctx.get(listenerCtx).updated((_listenerCtx, doc) => {
          // Live summary updates use the document watcher above: unlike this
          // debounced listener it also sees remote and history-excluded edits.
          // Persisted snapshots remain complete, including pending insertions.
          reporter.reportTitle(doc)
          scheduleSnapshot()
        })

        reporter.reportTitle(view.state.doc)

        if (canWrite) {
          unbindMermaidHints = bindMermaidHintPersistence(
            view.dom,
            renderHints?.mermaid,
            scheduleSnapshot,
          )
        }
      })

      const handle = { editor, ydoc, provider }
      startedRef.current = true
      // Seed/initial sync ran with suggesting off; apply a pre-stored
      // suggest mode only now that the document content is settled.
      syncSuggesting(editor, suggestingRef.current)
      callbacksRef.current.onReady?.(handle)
      callbacksRef.current.onStatus?.('live')
    }

    // Per grant, not per source: a refused claimant that reloads and wins the
    // same source again must be able to apply it.
    const seedGrant = `${seedVersion}:${seedClaim}`
    // A hydrated doc binds immediately — no visible empty-editor frame. A
    // fresh doc whose seed claim arrived with the page response also binds
    // immediately, applying the template from props (the one-shot consume in
    // connectWithSeed() plus applyTemplate's remote-empty guard keep this race-safe
    // against a channel-granted seeder). Only a fresh doc with no grant —
    // someone else holds the claim — waits for content or the channel's grant.
    if (provider.synced || ydoc.store.clients.size > 0) {
      start()
    } else if (seedGranted && seedContent && !seedAlreadyApplied(slug, seedGrant)) {
      markSeedApplied(slug, seedGrant)
      provider.seedContent = seedContent
      provider.seedClaim = seedClaim ?? null
      provider.seedFormat = contentFormat
      provider.seedAuthorKind = seedAuthorKind ?? null
      provider.seedAuthorName = seedAuthorName ?? null
      start()
    } else {
      provider.on('synced', start)
    }

    return () => {
      cancelled = true
      provider.off('synced', start)
      provider.off('stale', stale)
      provider.off('access-changed', accessChanged)
      provider.off('rejected', rejected)
      provider.off('unsaved-edit', unsavedEdit)
      unbindMermaidHints?.()
      reporter.cancelPending()
      snapshots.dispose()
      try {
        editor.action((ctx) => ctx.get(collabServiceCtx).disconnect())
      } catch {
        // editor may already be destroyed during unmount — fine
      }
      releaseSession(slug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, slug, contentFormat, canWrite, connectionIdentity])

  // ProseMirror caches editable at each state update; an empty transaction
  // makes it re-read the prop when the mode flips. Safe pre-bind: the action
  // no-ops until the view exists.
  useEffect(() => {
    if (loading) return
    const editor = get()
    if (!editor) return
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr)
      })
    } catch {
      // view not mounted yet — the initial editable value applies at bind
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, taskInteractive, loading])

  // Mode flips after start: sync suggesting into the plugin state. Before
  // start, the ref alone carries the value — start() applies it post-seed.
  useEffect(() => {
    if (loading || !startedRef.current) return
    const editor = get()
    if (editor) syncSuggesting(editor, suggesting)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggesting, loading])

  const sketchEditor = useSketchEditing({
    slug,
    contentFormat,
    get,
    controlsRef: sketchControlsRef,
    editableRef,
    suggestingRef,
  })

  return (
    <>
      <Milkdown />
      {sketchEditor}
    </>
  )
}

export function DocumentEditor(props: EditorProps) {
  return (
    <MilkdownProvider>
      <CollabEditor {...props} />
    </MilkdownProvider>
  )
}
