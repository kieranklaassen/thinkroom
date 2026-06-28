import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
  schemaCtx,
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
import { getMarkdown } from '@milkdown/kit/utils'
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CableProvider, type DurableSnapshotPayload } from './cable_provider'
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
  attrsFromSketchData,
  DEFAULT_SKETCH_HEIGHT,
  EMPTY_SKETCH_SCENE,
  sketchControlsCtx,
  sketchNodeViewPlugins,
  sketchSchemaPlugins,
  type SketchData,
} from './sketch'
import { InlineSketch } from './sketch/sketch_inline'
import { suggestChangesMarks } from './suggest_changes'
import { suggestState, suggestDispatch } from './suggest_changes/intercept'
import { suggestGuard } from './suggest_changes/normalize'
import {
  enableSuggestChanges,
  disableSuggestChanges,
  suggestChangesKey,
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
import { configureCleanClipboard } from './clipboard'
import { renderSoftBreaks } from './line_breaks'
import { interactiveTaskListItems, taskPersistenceCtx } from './task_list_items'
import { selectionCallbackCtx, selectionWatcher } from './selection_watcher'
import { postJSON } from '../lib/csrf'
import {
  htmlDefaultValue,
  sanitizeHtml,
  serializeHtml,
  type DocumentFormat,
} from './document_format'
import { configureSlashMenu, slashMenu } from './slash_menu'
import { readPointerAwarenessCtx, readPointers } from './read_pointers'
import { mermaidDiagrams } from './mermaid'
import { richBlockWidthControls } from './rich_block_width'

export interface EditorHandle {
  editor: Editor
  ydoc: Y.Doc
  provider: CableProvider
}

export type ConnectionStatus = 'connecting' | 'live'

interface EditorProps {
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
  /** Who authored the seed source ('human' | 'agent' | null). Non-human
   *  seeds get their text explicitly AI-attributed after the collab
   *  connection renders them — otherwise seeded text is unmarked and
   *  counts as human in the provenance summary. */
  seedAuthorKind?: string | null
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

const SNAPSHOT_DEBOUNCE_MS = 900
const OPENABLE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

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
  window.open(url.href, '_blank', 'noopener,noreferrer')
  return true
}

// Start loading shiki at import time so it's warm as early as possible. The
// editor never waits on it: lazyShikiParser highlights synchronously once
// ready and upgrades already-painted code blocks in place via the plugin's
// lazy-parser protocol. Content paint is gated on nothing.
void loadShikiParser()
const shikiParser = lazyShikiParser()

function buildSnapshotPayload(
  ctx: Ctx,
  ydoc: Y.Doc,
  contentFormat: DocumentFormat,
): DurableSnapshotPayload {
  const view = ctx.get(editorViewCtx)
  const content =
    contentFormat === 'html'
      ? serializeHtml(view.state.doc, ctx.get(schemaCtx))
      : getMarkdown()(ctx)
  const spans = collectSpans(view.state.doc)
  let binaryState = ''
  Y.encodeStateVector(ydoc).forEach((byte) => {
    binaryState += String.fromCharCode(byte)
  })

  return { content, spans, state_vector: btoa(binaryState) }
}

function firstHeadingTitle(doc: ProseNode): string | null {
  let title: string | null = null
  doc.descendants((node) => {
    if (node.type.name !== 'heading' || node.attrs.level !== 1) return title === null

    title = node.textContent.replace(/\s+/g, ' ').trim().slice(0, 255) || null
    return false
  })
  return title
}

interface CollabSession {
  ydoc: Y.Doc
  provider: CableProvider
  refs: number
  destroyTimer: ReturnType<typeof setTimeout> | null
  canWrite: boolean
  connectionIdentity: string
}

// Sessions survive React StrictMode's mount→unmount→mount cycle. Without
// this, the first (immediately discarded) provider wins the server's seed
// claim and dies before applying the template, leaving the doc empty until
// the claim times out. Real teardown happens after a short grace period.
const sessions = new Map<string, CollabSession>()

function acquireSession(
  slug: string,
  identity: UserIdentity,
  canWrite: boolean,
  connectionIdentity: string,
  initialStateB64?: string | null,
): CollabSession {
  let session = sessions.get(slug)
  if (session && (session.canWrite !== canWrite || session.connectionIdentity !== connectionIdentity)) {
    if (session.destroyTimer) clearTimeout(session.destroyTimer)
    session.provider.destroy()
    session.ydoc.destroy()
    sessions.delete(slug)
    session = undefined
  }
  if (!session) {
    const ydoc = new Y.Doc()
    // Hydrate from the server-rendered state the moment the doc exists, so
    // the editor binds an already-populated doc and content is in its first
    // paint; Yjs converges idempotently when the provider's sync lands.
    // The clients-empty guard is redundant for a just-created Y.Doc but
    // keeps the hydration idempotent if this block ever runs on a doc
    // that already carries state.
    if (initialStateB64 && ydoc.store.clients.size === 0) {
      try {
        Y.applyUpdate(
          ydoc,
          Uint8Array.from(atob(initialStateB64), (c) => c.charCodeAt(0)),
          'server-hydrate',
        )
      } catch {
        // corrupt/stale prop — fall back to the wait-for-synced path
      }
    }
    const provider = new CableProvider(ydoc, slug, { canWrite, connectionIdentity })
    provider.awareness.setLocalStateField('user', identity)
    session = { ydoc, provider, refs: 0, destroyTimer: null, canWrite, connectionIdentity }
    sessions.set(slug, session)
  }
  if (session.destroyTimer) {
    clearTimeout(session.destroyTimer)
    session.destroyTimer = null
  }
  session.refs += 1
  return session
}

// History restores replay stale props: a back-navigation remounts the page
// with the original seed_granted: true long after the template was applied
// and synced. Re-applying onto a fresh local doc would duplicate the
// template when the server state merges in, so grant consumption is made
// durable per tab. The server generation is part of the key because owner
// CLI replacement keeps the slug while resetting the CRDT state to a new
// seed source; that new generation must be allowed to seed again.
const seedAppliedKey = (slug: string, seedVersion?: string | null) =>
  `pruf:seed-applied:${slug}:${seedVersion ?? 'unknown'}`

function seedAlreadyApplied(slug: string, seedVersion?: string | null): boolean {
  try {
    return sessionStorage.getItem(seedAppliedKey(slug, seedVersion)) === '1'
  } catch {
    return false
  }
}

function markSeedApplied(slug: string, seedVersion?: string | null): void {
  try {
    sessionStorage.setItem(seedAppliedKey(slug, seedVersion), '1')
  } catch {
    // best effort — worst case is the pre-fix behavior on history restore
  }
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

function releaseSession(slug: string): void {
  const session = sessions.get(slug)
  if (!session) return
  session.refs -= 1
  if (session.refs > 0) return
  session.destroyTimer = setTimeout(() => {
    sessions.delete(slug)
    session.provider.destroy()
    session.ydoc.destroy()
  }, 1000)
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

    let snapshotTimer: ReturnType<typeof setTimeout> | null = null
    let snapshotRetryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const pushSnapshot = (attempt = 0) => {
      if (!canWriteRef.current) return
      editor.action((ctx) => {
        void postJSON(`/d/${slug}/snapshot`, buildSnapshotPayload(ctx, ydoc, contentFormat))
          .then((response) => {
            if (response.status === 409 && attempt < 3 && !cancelled) {
              if (snapshotRetryTimer) clearTimeout(snapshotRetryTimer)
              snapshotRetryTimer = setTimeout(() => pushSnapshot(attempt + 1), 250)
            } else if (!response.ok) {
              console.warn('pruf: snapshot push rejected', response.status)
            }
          })
          .catch((error) => {
            // Best-effort persistence, but never silent: the agent API serves
            // these spans, so a permanently failing push must be observable.
            console.warn('pruf: snapshot push failed', error)
          })
      })
    }

    let started = false
    const syncSuggesting = (instance: Editor) => {
      try {
        instance.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          if (suggestingRef.current) enableSuggestChanges(view.state, view.dispatch)
          else disableSuggestChanges(view.state, view.dispatch)
        })
      } catch {
        // view not mounted yet — start() applies the current value
      }
    }
    const start = () => {
      if (started || cancelled) return
      started = true
      editor.action((ctx) => {
        const service = ctx.get(collabServiceCtx)
        ctx.set(readPointerAwarenessCtx.key, provider.awareness)
        service.bindDoc(ydoc).setAwareness(provider.awareness)
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
        if (seed && seedKind && seedKind !== 'human') {
          // Must run after connect(): only then has ySyncPlugin rendered the
          // seeded Yjs content into the view. The dispatched marks flow back
          // through the binding, so peers receive attributed content.
          attributeSeedToAgent(ctx.get(editorViewCtx), seedAuthor ?? '')
          // The updated listener skips addToHistory:false transactions, so
          // the chip never sees the marked doc on its own — push it directly.
          callbacksRef.current.onSpans?.(
            collectSpans(ctx.get(editorViewCtx).state.doc, {
              excludePendingInsertions: true,
            }),
          )
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
          if (snapshotTimer) clearTimeout(snapshotTimer)
          snapshotTimer = setTimeout(pushSnapshot, SNAPSHOT_DEBOUNCE_MS)
        })

        const title = firstHeadingTitle(ctx.get(editorViewCtx).state.doc)
        if (title) callbacksRef.current.onTitleChange?.(title)
      })

      const handle = { editor, ydoc, provider }
      startedRef.current = true
      // Seed/initial sync ran with suggesting off; apply a pre-stored
      // suggest mode only now that the document content is settled.
      syncSuggesting(editor)
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
      if (snapshotTimer) clearTimeout(snapshotTimer)
      if (snapshotRetryTimer) clearTimeout(snapshotRetryTimer)
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
    if (!editor) return
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        if (suggesting) enableSuggestChanges(view.state, view.dispatch)
        else disableSuggestChanges(view.state, view.dispatch)
      })
    } catch {
      // view not mounted yet — start() applies the current ref value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggesting, loading])

  const saveSketch = (data: SketchData, activate = false) => {
    if (!editableRef.current || suggestingRef.current) return
    const editor = get()
    if (!editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const type = view.state.schema.nodes.thinkroomSketch
      if (!type) return

      let existingPos: number | null = null
      view.state.doc.descendants((node, pos) => {
        if (node.type === type && node.attrs.id === data.id) {
          existingPos = pos
          return false
        }
        return existingPos === null
      })

      const attrs = attrsFromSketchData(data)
      const tr =
        existingPos === null
          ? view.state.tr.replaceSelectionWith(type.create(attrs)).scrollIntoView()
          : view.state.tr.setNodeMarkup(existingPos, type, attrs)
      tr.setMeta(SKIP_PROVENANCE, true)
      tr.setMeta(suggestChangesKey, { skip: true })
      view.dispatch(tr)

      if (activate) {
        requestAnimationFrame(() => {
          const sketch = view.dom.querySelector<HTMLElement>(
            `.thinkroom-sketch[data-sketch-id="${data.id}"]`,
          )
          sketch?.click()
        })
      }

      const session = sessions.get(slug)
      if (session) void session.provider.persistCurrentState(buildSnapshotPayload(ctx, session.ydoc, contentFormat))
    })
  }

  const deleteSketch = (id: string) => {
    if (!editableRef.current || suggestingRef.current) return
    const editor = get()
    if (!editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const type = view.state.schema.nodes.thinkroomSketch
      if (!type) return

      let targetPos = -1
      let targetSize = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type === type && node.attrs.id === id) {
          targetPos = pos
          targetSize = node.nodeSize
          return false
        }
        return targetPos < 0
      })
      if (targetPos < 0) return

      const tr = view.state.tr.delete(targetPos, targetPos + targetSize).scrollIntoView()
      tr.setMeta(SKIP_PROVENANCE, true)
      tr.setMeta(suggestChangesKey, { skip: true })
      view.dispatch(tr)

      const session = sessions.get(slug)
      if (session) void session.provider.persistCurrentState(buildSnapshotPayload(ctx, session.ydoc, contentFormat))
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
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const type = view.state.schema.nodes.thinkroomSketch
      if (!type) return
      let after = -1
      view.state.doc.descendants((node, pos) => {
        if (node.type === type && node.attrs.id === id) {
          after = pos + node.nodeSize
          return false
        }
        return after < 0
      })
      if (after < 0) return
      const nextNode = view.state.doc.nodeAt(after)
      const textPosition = nextNode?.isTextblock ? after + 1 : after
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, textPosition))
      view.dispatch(tr.scrollIntoView())
      requestAnimationFrame(() => view.focus())
    })
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
