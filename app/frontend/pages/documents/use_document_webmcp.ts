import type { RefObject } from 'react'
import type { EditorHandle } from '../../editor/milkdown_editor'
import type { DocumentFormat } from '../../editor/document_format'
import type { EditorMode } from '../../components/mode_control'
import { useWebmcpTools } from '../../lib/use_webmcp_tools'
import { executeManifestTool } from '../../lib/webmcp_execute'
import { executeEditorTool } from '../../lib/webmcp_editor'
import type { WebmcpManifest } from '../../lib/webmcp'
import type { OwnershipPayload } from '../../types/payloads'

// Tells a browser agent which capabilities in a result are the human viewer's
// (this tab) versus its own anonymous ones (the API body's `ownership`).
const VIEWER_CONTEXT_NOTE =
  "These are the human viewer's capabilities in this tab. Your own capabilities as an anonymous agent are the ownership object in the API body."

interface Options {
  slug: string
  contentFormat: DocumentFormat
  webmcp: WebmcpManifest
  handleRef: RefObject<EditorHandle | null>
  modeRef: RefObject<EditorMode>
  ownershipRef: RefObject<OwnershipPayload>
}

// Registers this document's WebMCP tools once per slug (KTD5). Mode
// switches and partial reloads re-render without remounting, so the
// executor reads the live mode and ownership through refs instead of
// closing over them at registration time.
export function useDocumentWebmcp({
  slug,
  contentFormat,
  webmcp,
  handleRef,
  modeRef,
  ownershipRef,
}: Options): void {
  useWebmcpTools({
    key: slug,
    tools: webmcp.tools,
    execute: (tool, args, signal) => {
      const { yours, can_write, can_comment, link_access } = ownershipRef.current
      const viewerContext = {
        ownership: { yours, can_write, can_comment, link_access },
        mode: modeRef.current,
        share_url: webmcp.share_url,
        note: VIEWER_CONTEXT_NOTE,
      }
      // Editor tools run in-page against the live editor; only this page
      // holds the handle, so the interpreter never sees them (KTD1–KTD3).
      if (tool.kind === 'editor') {
        return executeEditorTool(tool, args, {
          handle: handleRef.current,
          canWrite: can_write,
          slug,
          contentFormat,
          signal,
          viewerContext,
        })
      }
      return executeManifestTool(tool, args, { signal, viewerContext })
    },
  })
}
