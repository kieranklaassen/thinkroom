import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { Editor, editorViewCtx, rootCtx } from '@milkdown/kit/core'
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
import { getMarkdown } from '@milkdown/kit/utils'
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight'
import type { Parser } from '@milkdown/plugin-highlight/shiki'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { EditorView } from '@milkdown/kit/prose/view'
import { CableProvider } from './cable_provider'
import { loadShikiParser } from './highlighter'
import { imageUploader } from './upload'
import type { UserIdentity } from './identity'
import { provenance, provenanceIdentityCtx, collectSpans, type ProvenanceSpan } from './provenance'
import {
  alignCenterIcon,
  alignLeftIcon,
  alignRightIcon,
  gripIcon,
  plusIcon,
  trashIcon,
} from './table_icons'
import { agentCursors } from './agent_cursors'
import { selectionCallbackCtx, selectionWatcher } from './selection_watcher'
import { postJSON } from '../lib/csrf'

export interface EditorHandle {
  editor: Editor
  ydoc: Y.Doc
  provider: CableProvider
}

export type ConnectionStatus = 'connecting' | 'live'

interface EditorProps {
  slug: string
  identity: UserIdentity
  /** Server-rendered Yjs state (base64) — hydrates the doc before the
   *  provider syncs, so the first paint is already populated. */
  initialStateB64?: string | null
  onReady?: (handle: EditorHandle) => void
  onStatus?: (status: ConnectionStatus) => void
  onSpans?: (spans: ProvenanceSpan[]) => void
  onSelection?: (view: EditorView) => void
}

const SNAPSHOT_DEBOUNCE_MS = 900

// Start loading shiki at import time so the parser is warm by mount.
const shikiParserPromise = loadShikiParser()

interface CollabSession {
  ydoc: Y.Doc
  provider: CableProvider
  refs: number
  destroyTimer: ReturnType<typeof setTimeout> | null
}

// Sessions survive React StrictMode's mount→unmount→mount cycle. Without
// this, the first (immediately discarded) provider wins the server's seed
// claim and dies before applying the template, leaving the doc empty until
// the claim times out. Real teardown happens after a short grace period.
const sessions = new Map<string, CollabSession>()

function acquireSession(slug: string, identity: UserIdentity): CollabSession {
  let session = sessions.get(slug)
  if (!session) {
    const ydoc = new Y.Doc()
    const provider = new CableProvider(ydoc, slug)
    provider.awareness.setLocalStateField('user', identity)
    session = { ydoc, provider, refs: 0, destroyTimer: null }
    sessions.set(slug, session)
  }
  if (session.destroyTimer) {
    clearTimeout(session.destroyTimer)
    session.destroyTimer = null
  }
  session.refs += 1
  return session
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

function EditorInner(props: EditorProps) {
  const [parser, setParser] = useState<Parser | null>(null)

  useEffect(() => {
    // Wrap in an updater: passing the parser function directly would make
    // React call it as a state updater.
    void shikiParserPromise.then((p) => setParser(() => p))
  }, [])

  if (!parser) return <div className="doc-editor-loading" aria-hidden />
  return <CollabEditor {...props} parser={parser} />
}

function CollabEditor({
  slug,
  identity,
  parser,
  initialStateB64,
  onReady,
  onStatus,
  onSpans,
  onSelection,
}: EditorProps & { parser: Parser }) {
  const callbacksRef = useRef({ onReady, onStatus, onSpans, onSelection })
  callbacksRef.current = { onReady, onStatus, onSpans, onSelection }

  const { get, loading } = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(provenanceIdentityCtx.key, { name: identity.name })
          ctx.update(highlightPluginConfig.key, (prev) => ({
            ...prev,
            parser,
            languageExtractor: (node) => (node.attrs.language as string) ?? '',
          }))
          ctx.update(uploadConfig.key, (prev) => ({
            ...prev,
            uploader: imageUploader,
            enableHtmlFileUploader: true,
          }))
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
        .use(tableBlock)
        .use(listener)
        .use(clipboard)
        .use(cursor)
        .use(indent)
        .use(trailing)
        .use(highlight)
        .use(upload)
        .use(provenance)
        .use(selectionWatcher)
        .use(agentCursors)
        .use(collab),
    [],
  )

  useEffect(() => {
    if (loading) return
    const editor = get()
    if (!editor) return

    const { ydoc, provider } = acquireSession(slug, identity)
    callbacksRef.current.onStatus?.('connecting')

    // Hydrate from the server-rendered state so the first paint is already
    // populated; Yjs converges idempotently when the provider's sync lands.
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

    let snapshotTimer: ReturnType<typeof setTimeout> | null = null
    const pushSnapshot = () => {
      editor.action((ctx) => {
        const markdown = getMarkdown()(ctx)
        const view = ctx.get(editorViewCtx)
        const spans = collectSpans(view.state.doc)
        void postJSON(`/d/${slug}/snapshot`, { markdown, spans }).catch(() => {})
      })
    }

    let started = false
    let cancelled = false
    const start = () => {
      if (started || cancelled) return
      started = true
      editor.action((ctx) => {
        const service = ctx.get(collabServiceCtx)
        service.bindDoc(ydoc).setAwareness(provider.awareness)
        if (provider.seedMarkdown) {
          // Server granted this client the seed claim; the default condition
          // (remote doc empty) double-guards against racing another seeder.
          // Consume one-shot so a remounted editor never re-applies.
          service.applyTemplate(provider.seedMarkdown)
          provider.seedMarkdown = null
        }
        service.connect()

        ctx.set(selectionCallbackCtx.key, {
          fn: (view) => callbacksRef.current.onSelection?.(view),
        })

        ctx.get(listenerCtx).updated((_listenerCtx, doc) => {
          callbacksRef.current.onSpans?.(collectSpans(doc))
          if (snapshotTimer) clearTimeout(snapshotTimer)
          snapshotTimer = setTimeout(pushSnapshot, SNAPSHOT_DEBOUNCE_MS)
        })
      })

      const handle = { editor, ydoc, provider }
      callbacksRef.current.onReady?.(handle)
      callbacksRef.current.onStatus?.('live')
    }

    // A hydrated doc binds immediately — no visible empty-editor frame. The
    // first-ever load (no state yet) keeps waiting for the seed-claim sync.
    if (provider.synced || ydoc.store.clients.size > 0) start()
    else provider.on('synced', start)

    return () => {
      cancelled = true
      provider.off('synced', start)
      if (snapshotTimer) clearTimeout(snapshotTimer)
      try {
        editor.action((ctx) => ctx.get(collabServiceCtx).disconnect())
      } catch {
        // editor may already be destroyed during unmount — fine
      }
      releaseSession(slug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, slug])

  return <Milkdown />
}

export function DocumentEditor(props: EditorProps) {
  return (
    <MilkdownProvider>
      <EditorInner {...props} />
    </MilkdownProvider>
  )
}
