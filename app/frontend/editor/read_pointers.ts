import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import type { Awareness } from 'y-protocols/awareness'
import type { UserIdentity } from './identity'
import {
  collabSyncState,
  fromRelativePosition,
  toRelativePosition,
  type CollabSyncState,
} from './collab_positions'

interface ReadPointerState {
  anchor?: unknown
}

interface AwarenessState {
  user?: UserIdentity
  readPointer?: ReadPointerState | null
}

export const readPointerAwarenessCtx = $ctx<Awareness | null, 'readPointerAwareness'>(
  null,
  'readPointerAwareness',
)

const readPointerKey = new PluginKey('READ_POINTERS')
const SAFE_COLOR = /^#[0-9a-f]{6}$/i

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
  syncState: CollabSyncState | undefined,
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

    const position = fromRelativePosition(state, anchorJson, syncState)
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
          collabSyncState(oldState),
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
    let frame: number | null = null
    let lastSnapshot: string | null = null

    // Only the peers' readPointer anchors (and the identity rendered in the
    // pointer chip) feed the decorations, so only dispatch when that slice of
    // awareness actually changed. Awareness 'change' fires for EVERY peer
    // update — cursors, viewports, presence — and an unconditional dispatch
    // per tick both stomps a collaborator's in-flight native text selection
    // (the view re-imposes its state selection over a mid-drag DOM range)
    // and, dispatched synchronously, recurses into a stack overflow when a
    // publisher re-emits during updateState (y-prosemirror's cursor does
    // under a pending suggestion). Snapshot-gate plus one frame of
    // coalescing removes both failure modes.
    const pointerSnapshot = (): string => {
      if (!awareness) return ''
      const parts: string[] = []
      awareness.getStates().forEach((rawState, clientId) => {
        if (clientId === awareness!.clientID) return
        const state = rawState as AwarenessState
        const anchor = state.readPointer?.anchor
        if (!anchor) return
        parts.push(
          `${clientId}:${JSON.stringify(anchor)}:${state.user?.name ?? ''}:${state.user?.color ?? ''}`,
        )
      })
      return parts.sort().join('|')
    }
    const refresh = () => {
      frame = null
      if (destroyed) return
      const snapshot = pointerSnapshot()
      if (snapshot === lastSnapshot) return
      lastSnapshot = snapshot
      view.dispatch(view.state.tr.setMeta(readPointerKey, true))
    }
    const scheduleRefresh = () => {
      if (destroyed || frame !== null) return
      frame = requestAnimationFrame(refresh)
    }
    const bindAwareness = () => {
      const nextAwareness = ctx.get(readPointerAwarenessCtx.key)
      if (nextAwareness === awareness) return
      awareness?.off('change', scheduleRefresh)
      awareness = nextAwareness
      lastSnapshot = null
      awareness?.on('change', scheduleRefresh)
      scheduleRefresh()
    }

    bindAwareness()
    return {
      update: bindAwareness,
      destroy: () => {
        destroyed = true
        if (frame !== null) cancelAnimationFrame(frame)
        awareness?.off('change', scheduleRefresh)
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

    const anchor = toRelativePosition(editorView.state, found.pos)
    if (!anchor) return
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
