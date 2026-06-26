import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from 'y-prosemirror'
import type { UserIdentity } from './identity'

interface ReadPointerState {
  anchor?: unknown
}

interface AwarenessState {
  user?: UserIdentity
  readPointer?: ReadPointerState | null
}

interface SyncState {
  doc: Y.Doc
  type: Y.XmlFragment
  binding: {
    mapping: Parameters<typeof absolutePositionToRelativePosition>[2]
  }
}

export const readPointerAwarenessCtx = $ctx<Awareness | null, 'readPointerAwareness'>(
  null,
  'readPointerAwareness',
)

const readPointerKey = new PluginKey('READ_POINTERS')
const SAFE_COLOR = /^#[0-9a-f]{6}$/i

// @milkdown/plugin-collab is prebundled by Vite, so importing its
// ySyncPluginKey through the app can create a second key object. Locate the
// installed y-sync plugin by its stable ProseMirror key instead.
const syncStateFor = (state: EditorState): SyncState | undefined => {
  const syncKey = state.plugins.map((plugin) => plugin.spec.key).find((pluginKey) => {
    const runtimeKey = pluginKey as unknown as { key?: string } | undefined
    return runtimeKey?.key === 'y-sync$'
  })
  return syncKey?.getState(state) as SyncState | undefined
}

const buildPointer = (user: UserIdentity | undefined): HTMLElement => {
  const color = user?.color && SAFE_COLOR.test(user.color) ? user.color : '#9d4edd'
  const cursor = document.createElement('span')
  cursor.className = 'ProseMirror-yjs-cursor read-pointer-cursor'
  cursor.style.borderColor = color

  const label = document.createElement('div')
  label.style.backgroundColor = color
  label.textContent = `↗ ${user?.name || 'Reader'}`
  cursor.append('\u2060', label, '\u2060')
  return cursor
}

const decorationsFor = (
  state: EditorState,
  awareness: Awareness | null,
  syncState: SyncState | undefined,
): DecorationSet => {
  if (!awareness || !syncState || syncState.binding.mapping.size === 0) {
    return DecorationSet.empty
  }

  const decorations: Decoration[] = []
  awareness.getStates().forEach((rawState, clientId) => {
    if (clientId === awareness.clientID) return
    const awarenessState = rawState as AwarenessState
    const anchorJson = awarenessState.readPointer?.anchor
    if (!anchorJson) return

    const position = relativePositionToAbsolutePosition(
      syncState.doc,
      syncState.type,
      Y.createRelativePositionFromJSON(anchorJson),
      syncState.binding.mapping,
    )
    if (position === null) return

    const boundedPosition = Math.min(position, state.doc.content.size)
    decorations.push(
      Decoration.widget(boundedPosition, () => buildPointer(awarenessState.user), {
        key: `read-pointer-${clientId}`,
        side: 10,
      }),
    )
  })
  return DecorationSet.create(state.doc, decorations)
}

const readPointerProse = $prose((ctx) => new Plugin({
  key: readPointerKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, previous, oldState, newState) {
      // This plugin is installed before Milkdown dynamically adds y-sync, so
      // ProseMirror has not applied y-sync's state field yet while building
      // `newState`. The complete old state has the live binding and mapping.
      if (transaction.getMeta(readPointerKey)) {
        return decorationsFor(
          newState,
          ctx.get(readPointerAwarenessCtx.key),
          syncStateFor(oldState),
        )
      }
      return previous.map(transaction.mapping, transaction.doc)
    },
  },
  props: {
    decorations: (state) => readPointerKey.getState(state),
  },
  view(view) {
    let awareness: Awareness | null = null
    let destroyed = false

    const refresh = () => {
      if (destroyed) return
      view.dispatch(view.state.tr.setMeta(readPointerKey, true))
    }
    const bindAwareness = () => {
      const nextAwareness = ctx.get(readPointerAwarenessCtx.key)
      if (nextAwareness === awareness) return
      awareness?.off('change', refresh)
      awareness = nextAwareness
      awareness?.on('change', refresh)
      queueMicrotask(refresh)
    }

    bindAwareness()
    return {
      update: bindAwareness,
      destroy: () => {
        destroyed = true
        awareness?.off('change', refresh)
      },
    }
  },
}))

export const readPointers = [readPointerAwarenessCtx, readPointerProse].flat()

/**
 * Publishes a reader's hover position without focusing or selecting inside
 * ProseMirror. The custom field stays independent from y-prosemirror's normal
 * editing cursor, whose plugin intentionally clears itself when unfocused.
 */
export function bindReadPointerBroadcast(
  editor: Editor,
  awareness: Awareness,
): () => void {
  let view: EditorView | null = null
  editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  if (!view) return () => undefined

  const editorView = view as EditorView
  let frame: number | null = null
  let latestPoint: { left: number; top: number } | null = null
  let lastPosition: number | null = null

  // Read mode should never leave the ordinary editing caret visible remotely.
  editorView.dom.blur()
  awareness.setLocalStateField('cursor', null)

  const clear = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    latestPoint = null
    if (lastPosition !== null) awareness.setLocalStateField('readPointer', null)
    lastPosition = null
  }
  const publish = () => {
    frame = null
    if (!latestPoint) return
    const found = editorView.posAtCoords(latestPoint)
    if (!found || found.pos === lastPosition) return

    const syncState = syncStateFor(editorView.state)
    if (!syncState || syncState.binding.mapping.size === 0) return
    const anchor = absolutePositionToRelativePosition(
      found.pos,
      syncState.type,
      syncState.binding.mapping,
    )
    lastPosition = found.pos
    awareness.setLocalStateField('readPointer', { anchor })
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    latestPoint = { left: event.clientX, top: event.clientY }
    if (frame === null) frame = requestAnimationFrame(publish)
  }

  editorView.dom.addEventListener('pointermove', onPointerMove, { passive: true })
  editorView.dom.addEventListener('pointerleave', clear)
  editorView.dom.addEventListener('pointercancel', clear)
  window.addEventListener('blur', clear)

  return () => {
    editorView.dom.removeEventListener('pointermove', onPointerMove)
    editorView.dom.removeEventListener('pointerleave', clear)
    editorView.dom.removeEventListener('pointercancel', clear)
    window.removeEventListener('blur', clear)
    clear()
  }
}
