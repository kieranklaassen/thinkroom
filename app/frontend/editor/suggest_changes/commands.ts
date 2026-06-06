import type { EditorView } from '@milkdown/kit/prose/view'
import {
  applySuggestion,
  revertSuggestion,
} from '@handlewithcare/prosemirror-suggest-changes'
import { SKIP_PROVENANCE } from '../provenance'

/**
 * Accept = insertion keeps its text (mark removed; human provenance is
 * already on it from type time) / deletion's text is removed. Reject inverts.
 *
 * Idempotent under cross-client races with no pre-scan: the library command
 * builds its transform from the marks present at execution time and returns
 * false without dispatching when none with this id remain — the CRDT
 * converges, the loser's click does nothing.
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
