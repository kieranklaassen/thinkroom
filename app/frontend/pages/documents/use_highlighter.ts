import { useCallback, useMemo, type RefObject } from 'react'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorMode } from '../../components/mode_control'
import type { EditorHandle } from '../../editor/milkdown_editor'
import {
  HIGHLIGHT_COLORS,
  applyHighlight,
  collectHighlights,
  removeHighlight,
  selectionHighlightColor,
  type HighlightGroup,
  type HighlightSnippet,
} from '../../editor/text_highlighter'
import { dispatchIntoView } from '../../lib/scroll_to_selection'
import type { TextTarget } from './use_floating_chrome'

interface Options {
  handle: EditorHandle | null
  viewRef: RefObject<EditorView | null>
  docTick: number
  textTarget: TextTarget | null
  /** Persisted legend names by color id. */
  names: Record<string, string>
  canWrite: boolean
  effectiveMode: EditorMode
}

/** The text highlighter: the legend's content and jumps, and the selection
 *  toolbar's color swatches. */
export function useHighlighter({ handle, viewRef, docTick, textTarget, names, canWrite, effectiveMode }: Options) {
  // Highlighter legend content, re-scanned from the live doc whenever it
  // changes (docTick — the same recompute signal the review surfaces use).
  const highlightGroups = useMemo<HighlightGroup[]>(() => {
    void docTick
    if (!handle) return []
    let groups: HighlightGroup[] = []
    try {
      handle.editor.action((ctx) => {
        groups = collectHighlights(ctx.get(editorViewCtx).state.doc)
      })
    } catch {
      // view not mounted yet
    }
    return groups
  }, [handle, docTick])

  // Applying colors mutates document content, so the swatches follow the
  // write capability, not just the visible toolbar (Comment mode selections
  // keep offering Comment only).
  const canHighlight = canWrite && effectiveMode === 'edit'
  // The selection's uniform color (drives the active-swatch styling).
  // textTarget is recreated on every selection/doc change, so this stays
  // fresh after a swatch click without a dedicated subscription.
  const activeHighlightColor = useMemo(() => {
    void docTick
    const view = viewRef.current
    if (!canHighlight || !view || textTarget?.kind !== 'selection') return null
    return selectionHighlightColor(view.state)
  }, [canHighlight, viewRef, textTarget, docTick])

  const highlightSwatches = useMemo(() => {
    if (!canHighlight) return undefined
    return HIGHLIGHT_COLORS.map((color) => ({
      id: color.id,
      label: names[color.id] || color.label,
      color: color.swatch,
      active: activeHighlightColor === color.id,
      onClick: () => {
        const view = viewRef.current
        if (!view) return
        // Decide apply-vs-remove from the live editor state, not the memoized
        // activeHighlightColor — a click can land before React re-renders
        // (docTick is rAF-deferred), and a stale snapshot would re-apply
        // instead of toggling off.
        if (selectionHighlightColor(view.state) === color.id) removeHighlight(view)
        else applyHighlight(view, color.id)
        view.focus()
      },
    }))
  }, [canHighlight, viewRef, names, activeHighlightColor])

  const jumpToHighlight = useCallback((snippet: HighlightSnippet) => {
    if (!handle) return
    // Not viewRef: it stays null until a selection reaches the page, and Read
    // mode never reports one.
    let view: EditorView
    try {
      view = handle.editor.action((ctx) => ctx.get(editorViewCtx))
    } catch {
      return // editor torn down mid-navigation
    }
    // Positions come from the last scan; a remote edit landing between scan
    // and click could shift them. TextSelection.between snaps to the nearest
    // valid inline positions instead of throwing on a stale range.
    const max = view.state.doc.content.size
    if (snippet.from >= snippet.to || snippet.to > max) return
    const tr = view.state.tr.setSelection(
      TextSelection.between(view.state.doc.resolve(snippet.from), view.state.doc.resolve(snippet.to)),
    )
    dispatchIntoView(view, tr)
    view.focus()
  }, [handle])

  return { highlightGroups, highlightSwatches, jumpToHighlight }
}
