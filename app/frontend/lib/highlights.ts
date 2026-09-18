import type { EditorView } from '@milkdown/kit/prose/view'

/** CSS Custom Highlight API feature gate (Safari < 17.2, older Firefox). */
export const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS

/** A DOM Range for a ProseMirror position span — for the Custom Highlight API. */
export function domRange(view: EditorView, from: number, to: number): Range | null {
  try {
    const start = view.domAtPos(from)
    const end = view.domAtPos(to)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
  } catch {
    return null
  }
}

export function setHighlight(name: string, ranges: Range[], priority = 0): void {
  if (!supportsHighlights) return
  if (ranges.length === 0) {
    CSS.highlights.delete(name)
    return
  }
  const highlight = new Highlight(...ranges)
  // Overlapping highlights resolve conflicting properties by priority; the
  // default 0 keeps every existing caller's behaviour.
  if (priority) highlight.priority = priority
  CSS.highlights.set(name, highlight)
}

export function clearHighlight(name: string): void {
  if (!supportsHighlights) return
  CSS.highlights.delete(name)
}
