import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { findTextRange } from './suggestions'

export interface AgentCursor {
  name: string
  location: string | null
}

export const agentCursorsCtx = $ctx<{ list: AgentCursor[] }, 'agentCursors'>(
  { list: [] },
  'agentCursors',
)

const agentCursorKey = new PluginKey('AGENT_CURSORS')
const cursorCleanup = new WeakMap<Node, () => void>()
const cursorLabels = new Set<HTMLElement>()
let cursorClampFrame: number | null = null
let cursorResizeObserver: ResizeObserver | null = null
let cursorIntersectionObserver: IntersectionObserver | null = null
let cursorMutationObserver: MutationObserver | null = null

const CURSOR_LABEL_GUTTER = 8

const clampCursorLabels = (verify = true) => {
  cursorClampFrame = null
  cursorLabels.forEach((label) => {
    label.style.removeProperty('--agent-cursor-shift')
    const rect = label.getBoundingClientRect()
    let shift = 0
    if (rect.right > window.innerWidth - CURSOR_LABEL_GUTTER) {
      shift = window.innerWidth - CURSOR_LABEL_GUTTER - rect.right
    }
    if (rect.left + shift < CURSOR_LABEL_GUTTER) {
      shift += CURSOR_LABEL_GUTTER - (rect.left + shift)
    }
    label.style.setProperty('--agent-cursor-shift', `${Math.round(shift)}px`)
  })
  // A clamp scheduled during a viewport resize measures mid-reflow geometry
  // (window.innerWidth itself lags), lands a stale shift, and nothing later
  // corrects it. Verify once on the NEXT frame — where layout and
  // innerWidth have settled — and re-clamp (unverified, so this cannot
  // loop) if any label sits out of bounds.
  if (!verify) return
  cursorClampFrame = requestAnimationFrame(() => {
    cursorClampFrame = null
    let outOfBounds = false
    cursorLabels.forEach((label) => {
      const rect = label.getBoundingClientRect()
      if (rect.width === 0) return
      if (
        rect.right > window.innerWidth - CURSOR_LABEL_GUTTER + 1 ||
        rect.left < CURSOR_LABEL_GUTTER - 1
      ) {
        outOfBounds = true
      }
    })
    if (outOfBounds) clampCursorLabels(false)
  })
}

const scheduleCursorClamp = () => {
  if (cursorClampFrame !== null) return
  cursorClampFrame = requestAnimationFrame(() => clampCursorLabels())
}

const startCursorClampManager = () => {
  if (cursorResizeObserver) return
  cursorResizeObserver = new ResizeObserver(scheduleCursorClamp)
  cursorIntersectionObserver = new IntersectionObserver(scheduleCursorClamp, {
    rootMargin: '0px -8px',
    threshold: 1,
  })
  cursorMutationObserver = new MutationObserver(scheduleCursorClamp)
  cursorMutationObserver.observe(document.getElementById('app') ?? document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['class'],
  })
  window.addEventListener('resize', scheduleCursorClamp)
  document.addEventListener('scroll', scheduleCursorClamp, { capture: true, passive: true })
  document.addEventListener('transitionend', scheduleCursorClamp, true)
}

const stopCursorClampManager = () => {
  if (cursorClampFrame !== null) cancelAnimationFrame(cursorClampFrame)
  cursorClampFrame = null
  cursorResizeObserver?.disconnect()
  cursorIntersectionObserver?.disconnect()
  cursorMutationObserver?.disconnect()
  cursorResizeObserver = null
  cursorIntersectionObserver = null
  cursorMutationObserver = null
  window.removeEventListener('resize', scheduleCursorClamp)
  document.removeEventListener('scroll', scheduleCursorClamp, true)
  document.removeEventListener('transitionend', scheduleCursorClamp, true)
}

const registerCursorLabel = (label: HTMLElement) => {
  startCursorClampManager()
  cursorLabels.add(label)
  cursorResizeObserver?.observe(label)
  cursorIntersectionObserver?.observe(label)
  scheduleCursorClamp()
}

const unregisterCursorLabel = (label: HTMLElement) => {
  if (!cursorLabels.delete(label)) return
  cursorResizeObserver?.unobserve(label)
  cursorIntersectionObserver?.unobserve(label)
  if (cursorLabels.size === 0) stopCursorClampManager()
}

const buildCursorDOM = (agent: AgentCursor): HTMLElement => {
  const cursor = document.createElement('span')
  cursor.className = 'agent-cursor'
  const label = document.createElement('span')
  label.className = 'agent-cursor-label'
  label.textContent = `✦ ${agent.name}`
  cursor.appendChild(label)

  // Register synchronously: a next-frame deferral opened a race where a
  // widget destroyed and rebuilt within one frame (any decoration redraw)
  // could tear the clamp manager down mid-handoff, leaving the visible
  // label unobserved — it then never re-clamped on viewport resizes.
  // Observing a not-yet-attached element is safe; the registration's own
  // scheduleCursorClamp measures on the next frame, after PM attaches it.
  registerCursorLabel(label)
  cursorCleanup.set(cursor, () => {
    unregisterCursorLabel(label)
  })

  return cursor
}

/**
 * Labeled pseudo-cursors for agents working over the API. Agents aren't Yjs
 * awareness peers, so the server broadcasts their presence (+ the text they
 * said they're working near) and this plugin renders a cursor there —
 * visually parallel to human collaboration cursors.
 */
const agentCursorProse = $prose((ctx) => {
  return new Plugin({
    key: agentCursorKey,
    props: {
      decorations(state) {
        const { list } = ctx.get(agentCursorsCtx.key)
        if (list.length === 0) return DecorationSet.empty

        const decorations = list.map((agent) => {
          const range = agent.location ? findTextRange(state.doc, agent.location) : null
          const pos = range ? range.to : Math.max(0, state.doc.content.size - 1)
          return Decoration.widget(pos, () => buildCursorDOM(agent), {
            side: 1,
            key: `agent-${agent.name}-${pos}`,
            destroy: (node) => {
              cursorCleanup.get(node)?.()
              cursorCleanup.delete(node)
            },
          })
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
})

export const agentCursors = [agentCursorsCtx, agentCursorProse].flat()

/** Push the latest agent presence list into the editor's decoration layer. */
export function refreshAgentCursors(editor: Editor, list: AgentCursor[]): void {
  editor.action((ctx) => {
    ctx.set(agentCursorsCtx.key, { list })
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setMeta(agentCursorKey, true))
  })
}
