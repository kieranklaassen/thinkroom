import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx, schemaCtx, type Editor } from '@milkdown/kit/core'
import { getMarkdown } from '@milkdown/kit/utils'
import * as Y from 'yjs'
import type { DurableSnapshotPayload } from './cable_provider'
import { collectSpans } from './provenance'
import { collectMermaidRenderHints } from './mermaid'
import { serializeHtml, type DocumentFormat } from './document_format'
import { postJSON } from '../lib/csrf'

const SNAPSHOT_DEBOUNCE_MS = 900

export function buildSnapshotPayload(
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

  // Measured diagram heights ride along so the next load (any client) can
  // reserve the right space before mermaid renders.
  const mermaid = collectMermaidRenderHints(view.dom)
  const renderHints = Object.keys(mermaid).length > 0 ? { render_hints: { mermaid } } : {}

  return { content, spans, state_vector: btoa(binaryState), ...renderHints }
}

export interface SnapshotScheduler {
  /** Debounced push — one snapshot per burst of edits. */
  schedule: () => void
  /** Cancels pending pushes and blocks the in-flight retry chain. */
  dispose: () => void
}

/**
 * Debounced durable-snapshot pushes to the server, with a short retry chain
 * for 409s (another client's snapshot landed between read and write).
 * Best-effort persistence, but never silent: the agent API serves these
 * spans, so a permanently failing push must be observable.
 */
export function createSnapshotScheduler(options: {
  editor: Editor
  ydoc: Y.Doc
  slug: string
  contentFormat: DocumentFormat
  canWrite: () => boolean
}): SnapshotScheduler {
  const { editor, ydoc, slug, contentFormat, canWrite } = options
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const push = (attempt = 0) => {
    if (!canWrite()) return
    editor.action((ctx) => {
      void postJSON(`/d/${slug}/snapshot`, buildSnapshotPayload(ctx, ydoc, contentFormat))
        .then((response) => {
          if (response.status === 409 && attempt < 3 && !disposed) {
            if (retryTimer) clearTimeout(retryTimer)
            retryTimer = setTimeout(() => push(attempt + 1), 250)
          } else if (!response.ok) {
            console.warn('pruf: snapshot push rejected', response.status)
          }
        })
        .catch((error) => {
          console.warn('pruf: snapshot push failed', error)
        })
    })
  }

  return {
    schedule: () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => push(), SNAPSHOT_DEBOUNCE_MS)
    },
    dispose: () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (retryTimer) clearTimeout(retryTimer)
    },
  }
}
