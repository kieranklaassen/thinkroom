import type { EditorView } from '@milkdown/kit/prose/view'
import {
  applySuggestion,
  revertSuggestion,
} from '@handlewithcare/prosemirror-suggest-changes'
import { SKIP_PROVENANCE } from '../provenance'
import { collectInlineSuggestions } from './scan'

/**
 * Accept = insertion keeps its text (mark removed; human provenance is
 * already on it from type time) / deletion's text is removed. Reject inverts.
 *
 * Idempotent under cross-client races: the id is re-checked at execution
 * time and the library command itself no-ops (returns false) when the marks
 * are already gone — the CRDT converges, the loser's click does nothing.
 *
 * Resolve transactions skip history (an undo must not resurrect a resolved
 * suggestion) and skip the provenance writer (no re-attribution — accepted
 * text already carries the suggester's human mark). The library sets its own
 * skip meta so a resolve dispatched while in Suggest mode is never
 * re-intercepted into a new suggestion.
 */
function resolve(
  view: EditorView,
  id: string,
  command: typeof applySuggestion,
): boolean {
  const exists = collectInlineSuggestions(view.state.doc).some((s) => s.id === id)
  if (!exists) return false

  return command(id)(view.state, (tr) => {
    tr.setMeta('addToHistory', false)
    tr.setMeta(SKIP_PROVENANCE, true)
    view.dispatch(tr)
  })
}

export function acceptInlineSuggestion(view: EditorView, id: string): boolean {
  return resolve(view, id, applySuggestion)
}

export function rejectInlineSuggestion(view: EditorView, id: string): boolean {
  return resolve(view, id, revertSuggestion)
}
