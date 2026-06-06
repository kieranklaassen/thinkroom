import { $prose } from '@milkdown/kit/utils'
import {
  suggestChanges,
  withSuggestChanges,
} from '@handlewithcare/prosemirror-suggest-changes'
import type { EditorView } from '@milkdown/kit/prose/view'

/**
 * The library's state/decoration plugin: holds the per-client `enabled`
 * flag the dispatch wrapper consults, renders block-boundary deletion
 * markers, and skips cursor travel over its zero-width anchors. Suggesting
 * is enabled/disabled by dispatching the library's enable/disable commands
 * when the mode changes — plugin state is local, so one visitor suggesting
 * never flips collaborators into suggest mode.
 */
export const suggestState = $prose(() => suggestChanges())

/**
 * Fresh id per dispatch, unique across clients (concurrent numeric max+1
 * ids from two clients would collide and merge their suggestions). Adjacent
 * continuation does NOT consume new ids — the library reuses the abutting
 * mark's id, which is what groups contiguous typing into one suggestion.
 */
const clientNonce = Math.random().toString(36).slice(2, 8)
let counter = 0
const generateSuggestionId = (): string => `s${clientNonce}-${(counter += 1)}`

/**
 * The dispatch wrapper, wired through `editorViewOptionsCtx` at editor
 * construction (KTD 2 — this repo's Milkdown/collab stack sets no
 * `dispatchTransaction` of its own, and a plugin-init `setProps` would fire
 * during EditorView construction). Installed once and always present: it
 * passes transactions through untouched unless the suggestState plugin says
 * suggesting is enabled, and it never re-intercepts remote Yjs transactions,
 * undo/redo, or the library's own resolve commands (six-guard check in
 * `withSuggestChanges`). The transformed transaction — not the original — is
 * what appendTransaction plugins (provenanceWriter, suggest guard) observe.
 */
export const suggestDispatch: EditorView['dispatch'] = withSuggestChanges(
  undefined,
  generateSuggestionId,
)
