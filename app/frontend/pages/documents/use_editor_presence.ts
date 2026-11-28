import { useEffect } from 'react'
import { usePoll } from '@inertiajs/react'
import { refreshAgentCursors } from '../../editor/agent_cursors'
import type { UserIdentity } from '../../editor/identity'
import type { EditorHandle } from '../../editor/milkdown_editor'
import { provenanceIdentityCtx } from '../../editor/provenance'
import type { AgentPresencePayload } from '../../types/payloads'

/** Puts this viewer and the present agents into the live editor. Returns the
 *  poll that expires silent agents, for callers that are leaving the page. */
export function useEditorPresence(
  handle: EditorHandle | null,
  identity: UserIdentity,
  presences: AgentPresencePayload[],
): ReturnType<typeof usePoll> {
  // Identity state is the source of truth for the live editor surfaces:
  // re-applied whenever the handle arrives or the identity changes.
  // Idempotent — re-writing the same awareness state is a no-op for peers.
  useEffect(() => {
    if (!handle) return
    handle.provider.awareness.setLocalStateField('user', identity)
    handle.editor.action((ctx) => ctx.set(provenanceIdentityCtx.key, { name: identity.name }))
  }, [handle, identity])

  // Agent pseudo-cursors track the presences prop.
  useEffect(() => {
    if (!handle) return
    refreshAgentCursors(
      handle.editor,
      presences.map((p) => ({ name: p.agent_name, location: p.location_text })),
    )
  }, [handle, presences])

  // While agents are shown, poll so silent ones expire from the presence bar.
  const presencePoll = usePoll(
    45000,
    { only: ['presences'], async: true },
    { autoStart: false },
  )
  useEffect(() => {
    if (presences.length > 0) presencePoll.start()
    else presencePoll.stop()
  }, [presences.length, presencePoll])

  return presencePoll
}
