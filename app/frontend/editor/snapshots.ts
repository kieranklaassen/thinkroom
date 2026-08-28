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

export interface SnapshotTarget {
  editor: Editor
  ydoc: Y.Doc
  slug: string
  contentFormat: DocumentFormat
  /** Aborting stops the 409 retry chain; an in-flight request still settles. */
  signal?: AbortSignal
  /** Agent whose replacement this snapshot persists; logged to the activity feed. */
  agentName?: string
}

export type SnapshotPushOutcome =
  /** The server answered; `ok` mirrors `Response.ok`; `body` is its JSON when ok. */
  | { ok: boolean; status: number; body?: Record<string, unknown> | null; error?: undefined }
  /** The request never got a response (network failure, aborted mid-flight). */
  | { ok: false; status: null; error: unknown }

const SNAPSHOT_RETRY_LIMIT = 3
const SNAPSHOT_RETRY_DELAY_MS = 250

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * One durable-snapshot POST of the editor's current document, retrying a 409
 * (another client's snapshot landed between read and write) up to three
 * times at 250 ms. Never throws: the outcome is data so callers — the
 * debounced scheduler and the in-page replace tool, which awaits it before
 * answering the agent — decide how loud to be.
 */
function readSnapshotPayload(
  editor: Editor,
  ydoc: Y.Doc,
  contentFormat: DocumentFormat,
): DurableSnapshotPayload | null {
  let payload: DurableSnapshotPayload | null = null
  try {
    editor.action((ctx) => {
      payload = buildSnapshotPayload(ctx, ydoc, contentFormat)
    })
  } catch {
    // A torn-down editor (remount, navigation) has no view to read; the
    // caller treats null like any other failed push instead of throwing
    // after the replacement already dispatched.
    return null
  }
  return payload
}

export async function pushSnapshot(
  target: SnapshotTarget,
  attempt = 0,
): Promise<SnapshotPushOutcome> {
  const { editor, ydoc, slug, contentFormat, signal, agentName } = target
  const payload = readSnapshotPayload(editor, ydoc, contentFormat)
  if (!payload) return { ok: false, status: null, error: new Error('editor has no view') }

  let response: Response
  try {
    const body = agentName ? { ...payload, agent_name: agentName } : payload
    response = await postJSON(`/d/${slug}/snapshot`, body)
  } catch (error) {
    return { ok: false, status: null, error }
  }

  if (response.status === 409 && attempt < SNAPSHOT_RETRY_LIMIT && !signal?.aborted) {
    await delay(SNAPSHOT_RETRY_DELAY_MS)
    if (signal?.aborted) return { ok: false, status: response.status }
    return pushSnapshot(target, attempt + 1)
  }
  if (!response.ok) return { ok: false, status: response.status }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  return { ok: true, status: response.status, body }
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
  const lifetime = new AbortController()

  const push = () => {
    if (!canWrite()) return
    void pushSnapshot({ editor, ydoc, slug, contentFormat, signal: lifetime.signal }).then(
      (outcome) => {
        if (outcome.ok || lifetime.signal.aborted) return
        if (outcome.status === null) console.warn('pruf: snapshot push failed', outcome.error)
        else console.warn('pruf: snapshot push rejected', outcome.status)
      },
    )
  }

  return {
    schedule: () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(push, SNAPSHOT_DEBOUNCE_MS)
    },
    dispose: () => {
      lifetime.abort()
      if (timer) clearTimeout(timer)
    },
  }
}
