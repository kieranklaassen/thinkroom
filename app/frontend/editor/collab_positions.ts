import type { EditorState } from '@milkdown/kit/prose/state'
import * as Y from 'yjs'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from 'y-prosemirror'

export interface CollabSyncState {
  doc: Y.Doc
  type: Y.XmlFragment
  binding: {
    mapping: Parameters<typeof absolutePositionToRelativePosition>[2]
  }
}

// @milkdown/plugin-collab is prebundled by Vite, so importing its
// ySyncPluginKey through the app can create a second key object. Locate the
// installed y-sync plugin by its stable ProseMirror key instead.
export const collabSyncState = (state: EditorState): CollabSyncState | undefined => {
  const syncKey = state.plugins.map((plugin) => plugin.spec.key).find((pluginKey) => {
    const runtimeKey = pluginKey as unknown as { key?: string } | undefined
    return runtimeKey?.key === 'y-sync$'
  })
  return syncKey?.getState(state) as CollabSyncState | undefined
}

export const toRelativePosition = (
  state: EditorState,
  position: number,
): Y.RelativePosition | null => {
  const syncState = collabSyncState(state)
  if (!syncState || syncState.binding.mapping.size === 0) return null
  return absolutePositionToRelativePosition(
    position,
    syncState.type,
    syncState.binding.mapping,
  )
}

export const fromRelativePosition = (
  state: EditorState,
  anchorJson: unknown,
  syncState = collabSyncState(state),
): number | null => {
  if (!syncState || syncState.binding.mapping.size === 0) return null
  try {
    return relativePositionToAbsolutePosition(
      syncState.doc,
      syncState.type,
      Y.createRelativePositionFromJSON(anchorJson),
      syncState.binding.mapping,
    )
  } catch {
    return null
  }
}
