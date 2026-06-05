import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { Editor, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { indent } from '@milkdown/kit/plugin/indent'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight'
import type { Parser } from '@milkdown/plugin-highlight/shiki'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { CableProvider } from './cable_provider'
import { loadShikiParser } from './highlighter'
import type { UserIdentity } from './identity'

export interface EditorHandle {
  editor: Editor
  ydoc: Y.Doc
  provider: CableProvider
}

export type ConnectionStatus = 'connecting' | 'live'

interface EditorProps {
  slug: string
  identity: UserIdentity
  onReady?: (handle: EditorHandle) => void
  onStatus?: (status: ConnectionStatus) => void
}

function EditorInner({ slug, identity, onReady, onStatus }: EditorProps) {
  const [parser, setParser] = useState<Parser | null>(null)

  useEffect(() => {
    // Wrap in an updater: passing the parser function directly would make
    // React call it as a state updater.
    void loadShikiParser().then((p) => setParser(() => p))
  }, [])

  if (!parser) return <div className="doc-editor-loading" aria-hidden />
  return (
    <CollabEditor
      slug={slug}
      identity={identity}
      parser={parser}
      onReady={onReady}
      onStatus={onStatus}
    />
  )
}

function CollabEditor({
  slug,
  identity,
  parser,
  onReady,
  onStatus,
}: EditorProps & { parser: Parser }) {
  const handleRef = useRef<EditorHandle | null>(null)

  const { get, loading } = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.update(highlightPluginConfig.key, (prev) => ({
            ...prev,
            parser,
            languageExtractor: (node) => (node.attrs.language as string) ?? '',
          }))
        })
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(clipboard)
        .use(cursor)
        .use(indent)
        .use(trailing)
        .use(highlight)
        .use(collab),
    [],
  )

  useEffect(() => {
    if (loading) return
    const editor = get()
    if (!editor) return

    // Y.Doc and provider live outside the editor factory (StrictMode-safe:
    // this effect's cleanup tears them down symmetrically).
    const ydoc = new Y.Doc()
    const provider = new CableProvider(ydoc, slug)
    provider.awareness.setLocalStateField('user', identity)
    onStatus?.('connecting')

    let started = false
    const start = () => {
      if (started) return
      started = true
      editor.action((ctx) => {
        const service = ctx.get(collabServiceCtx)
        service.bindDoc(ydoc).setAwareness(provider.awareness)
        if (provider.seedMarkdown) {
          // Server granted this client the seed claim; the default condition
          // (remote doc empty) double-guards against racing another seeder.
          service.applyTemplate(provider.seedMarkdown)
        }
        service.connect()
      })
      const handle = { editor, ydoc, provider }
      handleRef.current = handle
      onReady?.(handle)
      onStatus?.('live')
    }

    if (provider.synced) start()
    else provider.on('synced', start)

    return () => {
      try {
        editor.action((ctx) => ctx.get(collabServiceCtx).disconnect())
      } catch {
        // editor may already be destroyed during unmount — fine
      }
      provider.destroy()
      ydoc.destroy()
      handleRef.current = null
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
