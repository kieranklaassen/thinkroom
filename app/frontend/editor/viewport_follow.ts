import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Awareness } from 'y-protocols/awareness'
import { fromRelativePosition, toRelativePosition } from './collab_positions'

interface ViewportAwarenessState {
  viewport?: {
    anchor?: unknown
    line?: number
    offset?: number
  } | null
}

const VIEWPORT_LINE = 0.42
const MIN_VISIBLE_LINE = 0.08
const MAX_VISIBLE_LINE = 0.92
const MAX_OFFSET_SCREENS = 2

const editorViewFor = (editor: Editor): EditorView | null => {
  let view: EditorView | null = null
  editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  return view
}

const viewportPoint = (view: EditorView): { left: number; top: number; line: number } | null => {
  const rect = view.dom.getBoundingClientRect()
  const visibleTop = Math.max(0, rect.top)
  const visibleBottom = Math.min(window.innerHeight, rect.bottom)
  if (visibleBottom <= visibleTop) return null

  const desiredTop = window.innerHeight * VIEWPORT_LINE
  const top = Math.min(Math.max(desiredTop, visibleTop + 1), visibleBottom - 1)
  return {
    left: rect.left + rect.width / 2,
    top,
    line: top / window.innerHeight,
  }
}

/** Publishes the document position currently crossing a comfortable viewport line. */
export function bindViewportBroadcast(editor: Editor, awareness: Awareness): () => void {
  const view = editorViewFor(editor)
  if (!view) return () => undefined

  let frame: number | null = null
  let lastPosition: number | null = null
  let lastLine: number | null = null
  let lastOffset: number | null = null

  const publish = () => {
    frame = null
    const point = viewportPoint(view)
    if (!point) return
    const found = view.posAtCoords(point)
    if (!found) return

    const roundedLine = Math.round(point.line * 1000) / 1000
    let offset = 0
    try {
      offset = Math.round(point.top - view.coordsAtPos(found.pos).top)
    } catch {
      // A remap between the coordinate lookups is harmless; zero is still a
      // usable anchor and the next scroll frame will refine it.
    }
    if (
      found.pos === lastPosition &&
      roundedLine === lastLine &&
      offset === lastOffset
    ) return
    const anchor = toRelativePosition(view.state, found.pos)
    if (!anchor) return

    lastPosition = found.pos
    lastLine = roundedLine
    lastOffset = offset
    awareness.setLocalStateField('viewport', { anchor, line: roundedLine, offset })
  }
  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(publish)
  }
  const clear = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    awareness.setLocalStateField('viewport', null)
  }

  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  queueMicrotask(schedule)

  return () => {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    clear()
  }
}

/** Keeps this window aligned to one remote awareness client's viewport anchor. */
export function bindViewportFollow(
  editor: Editor,
  awareness: Awareness,
  clientId: number,
  onUnavailable: () => void,
): () => void {
  const view = editorViewFor(editor)
  if (!view) return () => undefined

  let frame: number | null = null
  const follow = () => {
    frame = null
    const remoteState = awareness.getStates().get(clientId) as ViewportAwarenessState | undefined
    if (!remoteState) {
      onUnavailable()
      return
    }
    const anchorJson = remoteState.viewport?.anchor
    if (!anchorJson) return

    const position = fromRelativePosition(view.state, anchorJson)
    if (position === null) return
    const boundedPosition = Math.min(position, view.state.doc.content.size)
    const line = Math.min(
      MAX_VISIBLE_LINE,
      Math.max(MIN_VISIBLE_LINE, remoteState.viewport?.line ?? VIEWPORT_LINE),
    )
    const maxOffset = window.innerHeight * MAX_OFFSET_SCREENS
    const offset = Math.min(
      maxOffset,
      Math.max(-maxOffset, remoteState.viewport?.offset ?? 0),
    )

    try {
      const coordinates = view.coordsAtPos(boundedPosition)
      const delta = coordinates.top + offset - window.innerHeight * line
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'auto' })
    } catch {
      // The document can remap between awareness receipt and this animation
      // frame. The next viewport update will resolve against the new mapping.
    }
  }
  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(follow)
  }

  awareness.on('change', schedule)
  window.addEventListener('resize', schedule, { passive: true })
  queueMicrotask(schedule)

  return () => {
    awareness.off('change', schedule)
    window.removeEventListener('resize', schedule)
    if (frame !== null) cancelAnimationFrame(frame)
  }
}
