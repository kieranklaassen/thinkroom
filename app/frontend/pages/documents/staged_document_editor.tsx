import { useEffect, useRef, useState } from 'react'
import {
  DocumentEditor,
  type EditorHandle,
  type EditorProps,
} from '../../editor/milkdown_editor'

// Resolves once every image in the live editor has finished loading (or
// errored — a broken image settles at its broken-glyph size either way), or
// after `capMs` so nothing can pin the preview layer forever. The separator
// imgs ProseMirror inserts have no src and are excluded.
const waitForEditorImages = (capMs: number): Promise<void> => {
  const pending = Array.from(
    document.querySelectorAll<HTMLImageElement>('.doc-live-editor .ProseMirror img[src]'),
  ).filter((img) => !img.complete)
  if (pending.length === 0) return Promise.resolve()

  return new Promise((resolve) => {
    let remaining = pending.length
    const timer = setTimeout(() => resolve(), capMs)
    const settle = () => {
      remaining -= 1
      if (remaining === 0) {
        clearTimeout(timer)
        resolve()
      }
    }
    pending.forEach((img) => {
      img.addEventListener('load', settle, { once: true })
      img.addEventListener('error', settle, { once: true })
    })
  })
}

interface Props extends Omit<EditorProps, 'onReady'> {
  /** Server-rendered prose that carries first paint and holds layout height
   *  until the live editor swaps in. */
  contentHtml: string
  /** SSR/hydration island flag — the live editor mounts only client-side. */
  isClient: boolean
  /** The staged handle: set once the editor is ready AND its images have
   *  pixels; null again when this staged editor unmounts. Key the component
   *  on the editor session so a permission flip remounts the whole stage —
   *  a delayed callback from the old editor can then never hide the preview
   *  for a new remount. */
  onHandle: (handle: EditorHandle | null) => void
}

/**
 * Instant first paint: server-rendered prose fills the reserved editor
 * frame and holds the layout height. The live editor sits on top of it
 * (transparent) while Milkdown boots, so its synced content paints over the
 * identical preview — then the preview is dropped a couple frames later.
 * The preview is always behind the editor until then, so content is never
 * momentarily blank.
 *
 * The preview's images carry server-known width/height attributes; the
 * editor's ProseMirror image nodes don't, so an editor image that hasn't
 * decoded yet holds ZERO height and everything below it sits 320px high
 * until the bytes arrive — a visible double-jump right after the swap on
 * real-latency connections. The visible layer flips at booting→revealing
 * (the moment the handle is staged), so BOTH phase changes wait until the
 * editor's images have pixels (capped so a broken image can't pin the
 * preview), then ProseMirror gets two frames to paint before the preview
 * is dropped.
 */
export function StagedDocumentEditor({ contentHtml, isClient, onHandle, ...editorProps }: Props) {
  const [handle, setHandle] = useState<EditorHandle | null>(null)
  const [swapped, setSwapped] = useState(false)

  const onHandleRef = useRef(onHandle)
  onHandleRef.current = onHandle
  useEffect(() => {
    onHandleRef.current(handle)
  }, [handle])
  useEffect(() => () => onHandleRef.current(null), [])

  return (
    <div
      className="doc-editor-stack"
      data-phase={swapped ? 'live' : handle ? 'revealing' : 'booting'}
    >
      {!swapped && contentHtml && (
        <div className="doc-static-preview milkdown" aria-hidden="true">
          <div
            className="ProseMirror"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </div>
      )}
      {/* The editor is a client-only island: Milkdown/ProseMirror, Yjs, the
          ActionCable provider, and Excalidraw never render on the server.
          The server emits an empty doc-live-editor shell (identical on the
          client's first hydration render) and the static preview above
          carries first paint until the editor mounts post-hydration and the
          swap takes over. */}
      <div className="doc-live-editor">
        {isClient && (
          <DocumentEditor
            {...editorProps}
            onReady={(h) => {
              void waitForEditorImages(1500).then(() => {
                setHandle(h)
                requestAnimationFrame(() => requestAnimationFrame(() => setSwapped(true)))
              })
            }}
          />
        )}
      </div>
    </div>
  )
}
