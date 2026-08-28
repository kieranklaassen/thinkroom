import type { EditorHandle } from '../editor/milkdown_editor'
import type { DocumentFormat } from '../editor/document_format'
import { replaceDocumentContent } from '../editor/replace_document'
import { pushSnapshot } from '../editor/snapshots'
import { errorMessage, errorResult, textResult, type WebmcpEditorTool, type WebmcpResult } from './webmcp'
import { byteCapError, IDENTITY_ERROR, utf8Bytes } from './webmcp_execute'

/** Mirrors `Document.normalize_display_name`: the CRDT path has no server pass. */
const MAX_AUTHOR_LENGTH = 255
/** `previous_content` is returned for reverting; past this it is cut, and flagged. */
const PREVIOUS_CONTENT_LIMIT = 256 * 1024

export const NOT_WRITABLE_ERROR =
  'This link no longer allows editing. Ask the owner for an edit link or propose a suggestion instead.'
export const EDITOR_LOADING_ERROR = 'editor is still loading; retry in a moment'
export const EMPTY_CONTENT_ERROR = 'refused: new content is empty; the document was not changed'
export const NO_PROVENANCE_ERROR =
  'this editor cannot attribute agent text; the document was not changed'
const PERSISTENCE_LAG_NOTE = 'snapshot not persisted yet; reads may lag until the next snapshot'

export interface EditorToolContext {
  /** Null until the collaborative editor has started. */
  handle: EditorHandle | null
  /** Read at call time: tools register once per slug, access can change later. */
  canWrite: boolean
  slug: string
  contentFormat: DocumentFormat
  signal: AbortSignal
  /** Merged into every result when the tool is flagged `include_viewer_context`. */
  viewerContext: Record<string, unknown>
}

/**
 * Runs an `editor` manifest tool against the live editor in this tab. No
 * fetch to `/api/*`, no cookie, no token: the replacement rides the tab's own
 * Yjs sync, and the one request made — the durable snapshot POST — is the
 * same session-authorized call every human edit already makes. Every refusal
 * returns before the document is touched; the result is always data (KTD4).
 */
export async function executeEditorTool(
  tool: WebmcpEditorTool,
  args: Record<string, unknown>,
  context: EditorToolContext,
): Promise<WebmcpResult> {
  const withContext = (value: Record<string, unknown>): Record<string, unknown> =>
    tool.include_viewer_context ? { ...value, viewer_context: context.viewerContext } : value
  const refuse = (value: Record<string, unknown>): WebmcpResult => errorResult(withContext(value))

  try {
    const input = args && typeof args === 'object' ? args : {}

    const rawName = typeof input.agent_name === 'string' ? input.agent_name.trim() : ''
    if (!rawName) return refuse({ error: IDENTITY_ERROR })
    const author = rawName.slice(0, MAX_AUTHOR_LENGTH)

    const content = typeof input.content === 'string' ? input.content : ''
    if (content.trim() === '') return refuse({ error: EMPTY_CONTENT_ERROR })
    const bytes = utf8Bytes(content)
    const cap = tool.input_schema.properties.content?.maxLength
    if (typeof cap === 'number' && bytes > cap) return refuse(byteCapError('content', bytes, cap))

    if (!context.canWrite) return refuse({ error: NOT_WRITABLE_ERROR })
    const { handle } = context
    if (!handle) return refuse({ error: EDITOR_LOADING_ERROR })
    if (context.signal.aborted) return refuse({ error: 'cancelled' })

    const outcome = replaceDocumentContent(handle.editor, {
      source: content,
      format: context.contentFormat,
      author,
    })
    if ('error' in outcome) {
      return refuse({
        error: outcome.error === 'empty' ? EMPTY_CONTENT_ERROR : NO_PROVENANCE_ERROR,
      })
    }

    // Dispatched: from here on nothing is rolled back, including on abort.
    // Awaited so the agent's next read sees the new content (R6).
    const snap = await pushSnapshot({
      editor: handle.editor,
      ydoc: handle.ydoc,
      slug: context.slug,
      contentFormat: context.contentFormat,
      agentName: author,
    })

    const truncated = outcome.previous.length > PREVIOUS_CONTENT_LIMIT
    const autoRejected = snap.ok ? snap.body?.auto_rejected_suggestions : undefined
    const result: Record<string, unknown> = {
      ok: true,
      bytes,
      title: outcome.title,
      persisted: snap.ok,
      ...(typeof autoRejected === 'number' ? { auto_rejected_suggestions: autoRejected } : {}),
      previous_content: truncated
        ? outcome.previous.slice(0, PREVIOUS_CONTENT_LIMIT)
        : outcome.previous,
      ...(truncated ? { previous_content_truncated: true } : {}),
      note:
        `Replaced the whole document as pending AI provenance by ${author}; awaiting human review. ` +
        'The change is in the shared document and reaches connected collaborators through live sync; ' +
        'they cannot undo it — keep previous_content to revert. ' +
        (snap.ok
          ? 'Logged to the activity feed as you; pending suggestions whose target text is gone were auto-rejected (auto_rejected_suggestions).'
          : 'Not logged to the activity feed because the snapshot did not persist.'),
    }
    if (!snap.ok) {
      const accessLost = snap.status === 403 || snap.status === 423
      result.persistence_note = accessLost
        ? `${PERSISTENCE_LAG_NOTE}. ${NOT_WRITABLE_ERROR}`
        : PERSISTENCE_LAG_NOTE
      if (snap.status !== null) result.snapshot_status = snap.status
    }
    return textResult(withContext(result))
  } catch (error) {
    return refuse({ error: errorMessage(error) })
  }
}
