import type { Awareness } from 'y-protocols/awareness'

interface CursorAwarenessState {
  cursor?: unknown
  user?: { name?: string; color?: string }
}

type AwarenessChangeListener = (...args: never[]) => void

/**
 * Awareness façade for y-prosemirror's cursor plugin only.
 *
 * The cursor plugin dispatches a ProseMirror transaction on EVERY awareness
 * 'change' — any peer cursor, viewport, presence, or read-pointer tick. In
 * non-editable modes (Comment/Read) each dispatch re-imposes the state
 * selection over an in-flight native drag, so with a second tab open a
 * collaborator could never finish selecting text (see the 2026-07-01 dogfood
 * escalation). Same failure mode the app's own read-pointer plugin had; same
 * fix (read_pointers.ts): coalesce to one animation frame and only forward
 * the event when the slice that feeds the decorations — remote `cursor`
 * anchors plus the rendered `user` name/color — actually changed.
 *
 * Everything else (getStates, getLocalState, setLocalStateField for the
 * local cursor, doc, clientID, …) passes straight through to the real
 * awareness, so local cursor publication is untouched. Only listeners
 * registered through THIS wrapper are gated; the app's other consumers
 * (presence bar, read pointers, viewport follow) hold the raw awareness.
 */
export function gatedCursorAwareness(awareness: Awareness): Awareness {
  const gates = new Map<AwarenessChangeListener, { gated: () => void; cancel: () => void }>()

  const cursorSnapshot = (): string => {
    const parts: string[] = []
    awareness.getStates().forEach((rawState, clientId) => {
      if (clientId === awareness.clientID) return
      const state = rawState as CursorAwarenessState
      if (state.cursor == null) return
      parts.push(
        `${clientId}:${JSON.stringify(state.cursor)}:${state.user?.name ?? ''}:${state.user?.color ?? ''}`,
      )
    })
    return parts.sort().join('|')
  }

  const buildGate = (listener: AwarenessChangeListener) => {
    let frame: number | null = null
    let lastSnapshot = cursorSnapshot()
    const gated = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const snapshot = cursorSnapshot()
        if (snapshot === lastSnapshot) return
        lastSnapshot = snapshot
        listener()
      })
    }
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
    }
    return { gated, cancel }
  }

  return new Proxy(awareness, {
    get(target, property) {
      if (property === 'on') {
        return (event: string, listener: AwarenessChangeListener) => {
          if (event !== 'change') return target.on(event as 'change', listener as never)
          const gate = buildGate(listener)
          gates.set(listener, gate)
          return target.on('change', gate.gated as never)
        }
      }
      if (property === 'off') {
        return (event: string, listener: AwarenessChangeListener) => {
          if (event !== 'change') return target.off(event as 'change', listener as never)
          const gate = gates.get(listener)
          if (!gate) return target.off('change', listener as never)
          gates.delete(listener)
          gate.cancel()
          return target.off('change', gate.gated as never)
        }
      }
      const value = Reflect.get(target, property)
      // Bind methods to the real awareness so their internal state access
      // (observer maps, local state, doc) never sees the proxy as `this`.
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
