import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { indent } from '@milkdown/kit/plugin/indent'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import { tableBlock, tableBlockConfig } from '@milkdown/kit/component/table-block'
import type { RenderType } from '@milkdown/kit/component/table-block'
// Base ProseMirror styles the table-block chrome depends on: a positioned
// .ProseMirror ancestor and the prosemirror-tables fixed-layout/selection CSS.
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import './table_block.css'
import './frontmatter/frontmatter.css'
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { CableProvider, RenderHints } from './cable_provider'
import {
  acquireSession,
  getSession,
  markSeedApplied,
  releaseSession,
  seedAlreadyApplied,
} from './collab_session'
import { buildSnapshotPayload, createSnapshotScheduler } from './snapshots'
import { gatedCursorAwareness } from './cursor_awareness'
import { lazyShikiParser, loadShikiParser } from './highlighter'
import { imageUploader } from './upload'
import type { UserIdentity } from './identity'
import {
  provenance,
  provenanceIdentityCtx,
  collectSpans,
  SKIP_PROVENANCE,
  type ProvenanceSpan,
} from './provenance'
import { frontmatter } from './frontmatter'
import {
  DEFAULT_SKETCH_HEIGHT,
  EMPTY_SKETCH_SCENE,
  sketchControlsCtx,
  sketchNodeViewPlugins,
  sketchSchemaPlugins,
  type SketchData,
} from './sketch'
import { deleteSketchNode, focusAfterSketchNode, upsertSketchNode } from './sketch/doc_ops'
import { InlineSketch } from './sketch/sketch_inline'
import { suggestChangesMarks } from './suggest_changes'
import { suggestState, suggestDispatch } from './suggest_changes/intercept'
import { suggestGuard } from './suggest_changes/normalize'
import {
  enableSuggestChanges,
  disableSuggestChanges,
} from '@handlewithcare/prosemirror-suggest-changes'
import {
  alignCenterIcon,
  alignLeftIcon,
  alignRightIcon,
  gripIcon,
  plusIcon,
  trashIcon,
} from './table_icons'
import { agentCursors } from './agent_cursors'
import { codeBlockView } from './code_block_view'
import { configureCleanClipboard } from './clipboard'
import { renderSoftBreaks } from './line_breaks'
import { interactiveTaskListItems, taskPersistenceCtx } from './task_list_items'
import { selectionCallbackCtx, selectionWatcher } from './selection_watcher'
import type { CollaboratorKind } from '../types/payloads'
import {
  htmlDefaultValue,
  sanitizeHtml,
  type DocumentFormat,
} from './document_format'
import { configureSlashMenu, slashMenu } from './slash_menu'
import { readPointerAwarenessCtx, readPointers } from './read_pointers'
import {
  bindMermaidHintPersistence,
  mermaidDiagrams,
  mermaidRenderHintsCtx,
} from './mermaid'
import { richBlockWidthControls } from './rich_block_width'

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
  /** Server-rendered Yjs state (base64) — hydrates the doc before the
   *  provider syncs, so the first paint is already populated. */
  initialStateB64?: string | null
  /** Seed template for a never-edited document. Applied at bind time when
   *  the page response granted this client the seed claim. */
  seedContent?: string | null
  /** Changes whenever the server-side source generation changes. */
  seedVersion?: string | null
  /** True when documents#show atomically claimed the seed for this page
   *  load — the props-first path that skips the WebSocket round-trip. */
  seedGranted?: boolean
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
  onSelection?: (view: EditorView) => void
  onTitleChange?: (title: string) => void
}

interface ActiveSketch {
  data: SketchData
  mount: HTMLElement
  wrapper: HTMLElement
}

const OPENABLE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
// Signed Active Storage paths (blob redirect/proxy and the disk service).
// These URLs authenticate through their own signature, not the session, so
// they load fine in an external browser context.
const FILE_PATH_PREFIX = '/rails/active_storage/'

// Server-rendered on first paint when the request came from the Ruby Native
// iOS/Android shell (see app/views/layouts/application.html.erb).
function inNativeShell(): boolean {
  return document.documentElement.hasAttribute('data-native-app')
}

function openEditorLink(view: EditorView, event: Event): boolean {
  if (!(event instanceof MouseEvent) || event.button !== 0 || event.defaultPrevented) {
    return false
  }

  const target = event.target
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
  const anchor = element?.closest<HTMLAnchorElement>('a[href]')
  if (!anchor || !view.dom.contains(anchor)) return false

  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return false
  }
  if (!OPENABLE_LINK_PROTOCOLS.has(url.protocol)) return false

  event.preventDefault()
  // Inside the Ruby Native shell, window.open leaves the WKWebView for an
  // external browser context that carries none of the app's cookies — a
  // same-origin page link would land the signed-in user on a logged-out
  // session. Navigate the webview itself instead: the session carries and
  // the target page renders its own native chrome (including back).
  // Signed file URLs are deliberately excluded — they work externally via
  // their signature, while an in-place raw-file page would strand the user
  // with no back affordance in the shell's Normal Mode.
  const sameOriginPage =
    url.origin === window.location.origin && !url.pathname.startsWith(FILE_PATH_PREFIX)
  if (inNativeShell() && sameOriginPage) {
    if (typeof window.RubyNative?.visit === 'function') window.RubyNative.visit(url.href)
    else window.location.assign(url.href)
    return true
  }
  window.open(url.href, '_blank', 'noopener,noreferrer')
  return true
}

// Start loading shiki at import time so it's warm as early as possible. The
// editor never waits on it: lazyShikiParser highlights synchronously once
// ready and upgrades already-painted code blocks in place via the plugin's
// lazy-parser protocol. Content paint is gated on nothing.
void loadShikiParser()
const shikiParser = lazyShikiParser()

function firstHeadingTitle(doc: ProseNode): string | null {
  let title: string | null = null
  doc.descendants((node) => {
    if (node.type.name !== 'heading' || node.attrs.level !== 1) return title === null

    title = node.textContent.replace(/\s+/g, ' ').trim().slice(0, 255) || null
    return false
  })
  return title
}

// Attributes a freshly seeded document to its agent author. applyTemplate
// writes the Yjs fragment directly; the content reaches the ProseMirror view
// via ySyncPlugin's init render (a remote-tagged transaction the provenance
// writer skips), so seeded text lands unmarked — and collectSpans counts
// unmarked text as human. This mirrors applySuggestion's explicit-attribution
// + SKIP_PROVENANCE pattern, doc-wide. Only unmarked text is touched: if
// applyTemplate no-opped against another seeder's content, that content
// already carries marks and this dispatches nothing.
function attributeSeedToAgent(view: EditorView, author: string): void {
  const markType = view.state.schema.marks.provenance
  if (!markType) return

  let tr = view.state.tr
  let changed = false
  view.state.doc.descendants((node, pos, parent) => {
    if (!node.isText) return
    if (parent && !parent.type.allowsMarkType(markType)) return
    if (markType.isInSet(node.marks)) return
    tr = tr.addMark(
      pos,
      pos + node.nodeSize,
      markType.create({ kind: 'ai', author, state: 'pending' }),
    )
    changed = true
  })

  if (!changed) return
  tr.setMeta(SKIP_PROVENANCE, true)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

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
  initialStateB64,
  seedContent,
  seedVersion,
  seedGranted,
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
}: EditorProps) {
  const [sketchDraft, setSketchDraft] = useState<ActiveSketch | undefined>(undefined)
  const insertSketchRef = useRef<() => void>(() => undefined)
  const saveSketchRef = useRef<(data: SketchData) => void>(() => undefined)
  const deleteSketchRef = useRef<(id: string) => void>(() => undefined)
  const callbacksRef = useRef({ onReady, onStatus, onSpans, onSelection, onTitleChange })
  callbacksRef.current = { onReady, onStatus, onSpans, onSelection, onTitleChange }
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
  // Suggesting only syncs into plugin state after start() — the gate that
  // keeps seed/initial-sync transactions out of the dispatch transform.
  const startedRef = useRef(false)

  const { get, loading } = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(provenanceIdentityCtx.key, { name: identity.name })
          ctx.set(mermaidRenderHintsCtx.key, renderHints?.mermaid ?? {})
          ctx.set(sketchControlsCtx.key, {
            edit: (data, mount, wrapper) => setSketchDraft({ data, mount, wrapper }),
            save: (data) => saveSketchRef.current(data),
            insert: () => insertSketchRef.current(),
            delete: (id) => deleteSketchRef.current(id),
            close: (id) => setSketchDraft((current) => current?.data.id === id ? undefined : current),
            enabled: () => editableRef.current && !suggestingRef.current,
          })
          // Read-only modes gate USER input only — ProseMirror still accepts
          // programmatic transactions (Yjs sync, seeding, suggestion accept).
          // dispatchTransaction is the suggest-changes wrapper: a pass-through
          // unless the suggestState plugin says suggesting is enabled, with
          // remote/undo/resolve transactions never re-intercepted.
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            editable: () => editableRef.current,
            dispatchTransaction: suggestDispatch,
            transformPastedHTML: (html) => sanitizeHtml(html, 'external'),
            handleDOMEvents: {
              ...prev.handleDOMEvents,
              click: (view, event) =>
                prev.handleDOMEvents?.click?.(view, event) || openEditorLink(view, event),
            },
          }))
          ctx.update(highlightPluginConfig.key, (prev) => ({
            ...prev,
            parser: shikiParser,
            languageExtractor: (node) => (node.attrs.language as string) ?? '',
          }))
          ctx.update(uploadConfig.key, (prev) => ({
            ...prev,
            uploader: imageUploader(identity.name),
            enableHtmlFileUploader: true,
          }))
          configureCleanClipboard(ctx)
          configureSlashMenu(ctx)
          renderSoftBreaks(ctx)
          // The defaults are bare text ('+', 'left', …) — real icons required.
          ctx.update(tableBlockConfig.key, (prev) => ({
            ...prev,
            renderButton: (renderType: RenderType): string => {
              switch (renderType) {
                case 'add_row':
                case 'add_col':
                  return plusIcon
                case 'delete_row':
                case 'delete_col':
                  return trashIcon
                case 'align_col_left':
                  return alignLeftIcon
                case 'align_col_center':
                  return alignCenterIcon
                case 'align_col_right':
                  return alignRightIcon
                case 'col_drag_handle':
                case 'row_drag_handle':
                  return gripIcon
              }
            },
          }))
        })
        .use(commonmark)
        .use(codeBlockView)
        .use(gfm)
        .use(interactiveTaskListItems)
        .use(tableBlock)
        .use(listener)
        .use(clipboard)
        .use(cursor)
        .use(indent)
        .use(trailing)
        .use(highlight)
        .use(mermaidDiagrams)
        .use(upload)
        .use(provenance)
        .use(frontmatter)
        .use(sketchSchemaPlugins)
        .use(sketchNodeViewPlugins)
        .use(richBlockWidthControls)
        .use(slashMenu)
        .use(suggestChangesMarks)
        // Order matters: provenanceWriter (inside provenance) runs its
        // appendTransaction before suggestGuard's — the guard observes
        // already-attributed text (KTD 6 registration order).
        .use(suggestState)
        .use(suggestGuard)
        .use(selectionWatcher)
        .use(agentCursors)
        .use(readPointers)
        .use(collab),
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
    )
    callbacksRef.current.onStatus?.('connecting')

    let cancelled = false
    let unbindMermaidHints: (() => void) | null = null
    const snapshots = createSnapshotScheduler({
      editor,
      ydoc,
      slug,
      contentFormat,
      canWrite: () => canWriteRef.current,
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
        // Consume the seed one-shot: capture to locals before nulling so a
        // remounted editor never re-applies or re-attributes, and a later
        // refactor can't clear the author fields out from under the re-mark.
        const seed = provider.seedContent
        const seedFormat = provider.seedFormat
        const seedKind = provider.seedAuthorKind
        const seedAuthor = provider.seedAuthorName
        provider.seedContent = null
        provider.seedAuthorKind = null
        provider.seedAuthorName = null
        if (seed) {
          // Server granted this client the seed claim; the default condition
          // (remote doc empty) double-guards against racing another seeder.
          service.applyTemplate(
            seedFormat === 'html' ? htmlDefaultValue(seed, 'external') : seed,
          )
        }
        service.connect()
        if (seed) {
          if (seedKind && seedKind !== 'human') {
            // Must run after connect(): only then has ySyncPlugin rendered
            // the seeded Yjs content into the view. The dispatched marks flow
            // back through the binding, so peers receive attributed content.
            attributeSeedToAgent(ctx.get(editorViewCtx), seedAuthor ?? '')
            // The updated listener skips addToHistory:false transactions, so
            // the chip never sees the marked doc on its own — push directly.
            callbacksRef.current.onSpans?.(
              collectSpans(ctx.get(editorViewCtx).state.doc, {
                excludePendingInsertions: true,
              }),
            )
          }
          // Persist the applied (and attributed) seed NOW over HTTP
          // (keepalive) instead of waiting for the cable handshake. The cable
          // path drops local updates until 'sync' arrives, so a claimant that
          // navigated away within the first seconds burned the seed claim and
          // left the document blank for every viewer until the claim timeout.
          // The sync_update endpoint also broadcasts, so already-connected
          // viewers receive the seeded content live.
          provider.persistCurrentState(buildSnapshotPayload(ctx, ydoc, contentFormat))
        }

        ctx.set(selectionCallbackCtx.key, {
          fn: (view) => callbacksRef.current.onSelection?.(view),
        })

        ctx.get(listenerCtx).updated((_listenerCtx, doc) => {
          // Chip path: display-only exclusion of pending insertions. The
          // snapshot path below stays unfiltered — persisted provenance must
          // remain complete while suggestions are pending.
          callbacksRef.current.onSpans?.(collectSpans(doc, { excludePendingInsertions: true }))
          const title = firstHeadingTitle(doc)
          if (title) callbacksRef.current.onTitleChange?.(title)
          scheduleSnapshot()
        })

        const title = firstHeadingTitle(ctx.get(editorViewCtx).state.doc)
        if (title) callbacksRef.current.onTitleChange?.(title)

        if (canWrite) {
          unbindMermaidHints = bindMermaidHintPersistence(
            ctx.get(editorViewCtx).dom,
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

    // A hydrated doc binds immediately — no visible empty-editor frame. A
    // fresh doc whose seed claim arrived with the page response also binds
    // immediately, applying the template from props (the one-shot consume in
    // start() plus applyTemplate's remote-empty guard keep this race-safe
    // against a channel-granted seeder). Only a fresh doc with no grant —
    // someone else holds the claim — waits for the sync handshake.
    if (provider.synced || ydoc.store.clients.size > 0) {
      start()
    } else if (seedGranted && seedContent && !seedAlreadyApplied(slug, seedVersion)) {
      markSeedApplied(slug, seedVersion)
      provider.seedContent = seedContent
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
      unbindMermaidHints?.()
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

  // Sketch writes bypass the debounced snapshot: a closed sketch editor must
  // be durable immediately (persistCurrentState uses keepalive so a save
  // followed by navigation still lands).
  const persistSketchChange = (ctx: Ctx) => {
    const session = getSession(slug)
    if (session) {
      void session.provider.persistCurrentState(
        buildSnapshotPayload(ctx, session.ydoc, contentFormat),
      )
    }
  }

  const saveSketch = (data: SketchData, activate = false) => {
    if (!editableRef.current || suggestingRef.current) return
    const editor = get()
    if (!editor) return
    editor.action((ctx) => {
      if (upsertSketchNode(ctx.get(editorViewCtx), data, activate)) persistSketchChange(ctx)
    })
  }

  const deleteSketch = (id: string) => {
    if (!editableRef.current || suggestingRef.current) return
    const editor = get()
    if (!editor) return
    editor.action((ctx) => {
      if (deleteSketchNode(ctx.get(editorViewCtx), id)) persistSketchChange(ctx)
    })
    setSketchDraft(undefined)
  }

  saveSketchRef.current = (data) => {
    setSketchDraft((current) => current?.data.id === data.id ? { ...current, data } : current)
    saveSketch(data)
  }
  deleteSketchRef.current = (id) => deleteSketch(id)

  const focusAfterSketch = (id: string) => {
    const editor = get()
    if (!editor) return
    editor.action((ctx) => focusAfterSketchNode(ctx.get(editorViewCtx), id))
  }

  insertSketchRef.current = () => {
    if (!editableRef.current || suggestingRef.current) return
    saveSketch({
      id: crypto.randomUUID(),
      formatVersion: 1,
      description: '',
      height: DEFAULT_SKETCH_HEIGHT,
      scene: structuredClone(EMPTY_SKETCH_SCENE),
    }, true)
  }

  useEffect(() => {
    if (!sketchDraft) return
    sketchDraft.wrapper.classList.add('is-editing')
    return () => sketchDraft.wrapper.classList.remove('is-editing')
  }, [sketchDraft])

  return (
    <>
      <Milkdown />
      {sketchDraft && sketchDraft.mount.isConnected && createPortal(
        <InlineSketch
          data={sketchDraft.data}
          wrapper={sketchDraft.wrapper}
          onChange={saveSketch}
          onDelete={deleteSketch}
          onDone={(focusAfter = false) => {
            const id = sketchDraft.data.id
            setSketchDraft(undefined)
            if (focusAfter) focusAfterSketch(id)
          }}
        />,
        sketchDraft.mount,
      )}
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
