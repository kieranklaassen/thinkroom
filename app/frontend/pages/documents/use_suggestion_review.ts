import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { router } from '@inertiajs/react'
import { editorViewCtx, parserCtx, schemaCtx } from '@milkdown/kit/core'
import type { EditorHandle } from '../../editor/milkdown_editor'
import {
  applySuggestion,
  findSuggestionTarget,
  flashMergedRange,
  suggestionApplicability,
} from '../../editor/suggestions'
import { sourceParser, type DocumentFormat } from '../../editor/document_format'
import {
  acceptInlineSuggestion,
  collectInlineSuggestions,
  rejectInlineSuggestion,
  type InlineSuggestion,
} from '../../editor/suggest_changes'
import type { ReviewableSuggestion } from '../../components/suggestion_card'
import { patchJSON } from '../../lib/csrf'
import type { SuggestionPayload } from '../../types/payloads'

const skippedSuggestionNotice = (count: number): string =>
  `${count} suggestion${count === 1 ? '' : 's'} skipped because the target is missing, ambiguous, or empty; ${count === 1 ? 'it remains' : 'they remain'} pending for individual review.`

interface Options {
  handle: EditorHandle | null
  /** Live handle for code that runs after awaits or inside stable callbacks. */
  handleRef: RefObject<EditorHandle | null>
  suggestions: SuggestionPayload[]
  slug: string
  contentFormat: DocumentFormat
  identityName: string
  /** rAF-coalesced Yjs update counter — the recompute signal for anchors. */
  docTick: number
}

export interface SuggestionReview {
  /** Every pending review item (tracked edits first, then server rows) with
   *  its target range resolved once per doc version. The margin cards, the
   *  mobile sheet, and tap hit-testing all read these ranges instead of
   *  re-searching the document. */
  items: ReviewableSuggestion[]
  /** Server-backed pending suggestions — the population Accept all covers. */
  pendingSuggestionCount: number
  acceptAllSuggestions: () => Promise<void>
  acceptingAll: boolean
  suggestionNotice: string | null
  setSuggestionNotice: (notice: string | null) => void
}

/**
 * The suggestion resolution machine: accept/reject for server rows (agent
 * proposals) and doc-native tracked edits, bulk accept with reopen recovery,
 * and the unified ReviewableSuggestion view models the review surfaces render.
 */
export function useSuggestionReview({
  handle,
  handleRef,
  suggestions,
  slug,
  contentFormat,
  identityName,
  docTick,
}: Options): SuggestionReview {
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null)
  const suggestionsRef = useRef(suggestions)
  suggestionsRef.current = suggestions

  const reopenSuggestion = useCallback(
    async (suggestionId: number): Promise<boolean> => {
      try {
        const response = await patchJSON(`/suggestions/${suggestionId}/reopen`, {
          by: identityName,
        })
        if (response.ok) return true
        console.warn('pruf: suggestion reopen rejected', suggestionId, response.status)
      } catch (error) {
        console.warn('pruf: suggestion reopen failed', suggestionId, error)
      }
      return false
    },
    [identityName],
  )

  // Promise-based single accept, shared by the per-card button and Accept
  // all. The card clears optimistically, but the CRDT insert waits for the
  // server to confirm THIS client won the accept — otherwise two windows
  // accepting concurrently would each insert the text (the loser's PATCH
  // 422s, but a local-first insert could not be rolled back). The promise
  // settles on finish regardless of outcome so a bulk loop never stalls on
  // a suggestion someone else resolved first.
  const acceptOne = useCallback(
    (suggestion: SuggestionPayload) =>
      new Promise<void>((resolve) => {
        const live = handleRef.current
        // Optimistic placeholders (negative id) have no server row yet —
        // a PATCH against them would 404.
        if (!live || suggestion.id < 0) {
          resolve()
          return
        }
        const applicability = suggestionApplicability(live.editor, suggestion, contentFormat)
        if (!applicability.ok) {
          setSuggestionNotice(
            applicability.reason === 'ambiguous'
              ? 'This quoted text appears more than once. The suggestion is still pending so no content was changed.'
              : applicability.reason === 'missing'
                ? 'The quoted text has changed or was removed. The suggestion is still pending so no content was changed.'
                : 'This suggestion has no editable content and was left pending.',
          )
          resolve()
          return
        }
        router
          .optimistic((props: { suggestions?: SuggestionPayload[] }) => ({
            suggestions: (props.suggestions ?? []).filter((s) => s.id !== suggestion.id),
          }))
          .patch(
            `/suggestions/${suggestion.id}/accept`,
            { by: identityName },
            {
              preserveScroll: true,
              only: ['suggestions', 'activities'],
              async: true,
              onSuccess: () => {
                const editor = handleRef.current?.editor
                if (!editor) return
                const merged = applySuggestion(editor, suggestion, contentFormat)
                // A one-beat pulse on the merged text — the reward for review.
                if (merged) {
                  flashMergedRange(editor, merged)
                } else {
                  void reopenSuggestion(suggestion.id).then((reopened) => {
                    setSuggestionNotice(
                      reopened
                        ? 'The document changed before this suggestion could be merged. It was returned to pending.'
                        : 'The document changed before this suggestion could be merged, and Thinkroom could not restore it to pending. Refresh before reviewing it again.',
                    )
                    router.reload({ only: ['suggestions', 'activities'], async: true })
                  })
                }
              },
              onFinish: () => resolve(),
            },
          )
      }),
    [handleRef, identityName, contentFormat, reopenSuggestion],
  )

  const acceptSuggestion = useCallback(
    (suggestion: SuggestionPayload) => {
      void acceptOne(suggestion)
    },
    [acceptOne],
  )

  const rejectSuggestion = useCallback(
    (suggestion: SuggestionPayload) => {
      if (suggestion.id < 0) return
      router
        .optimistic((props: { suggestions?: SuggestionPayload[] }) => ({
          suggestions: (props.suggestions ?? []).filter((s) => s.id !== suggestion.id),
        }))
        .patch(
          `/suggestions/${suggestion.id}/reject`,
          { by: identityName },
          { preserveScroll: true, only: ['suggestions', 'activities'], async: true },
        )
    },
    [identityName],
  )

  // Doc-native tracked edits resolve via local ProseMirror commands that
  // sync through Yjs — no server round-trip. Idempotent under cross-client
  // races: the command no-ops when the marks are already gone.
  const resolveInline = useCallback(
    (s: InlineSuggestion, accept: boolean) => {
      const live = handleRef.current
      if (!live) return
      try {
        live.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const acted = accept
            ? acceptInlineSuggestion(view, s.id)
            : rejectInlineSuggestion(view, s.id)
          // Flash only the pure-insertion accept: mark removal preserves
          // positions, so the snapshot range is still valid. Deletion and
          // mixed accepts remove text, leaving s.from/s.to stale.
          if (acted && accept && s.insertedText && !s.deletedText) {
            const max = view.state.doc.content.size
            flashMergedRange(live.editor, {
              from: Math.min(s.from, max),
              to: Math.min(s.to, max),
            })
          }
        })
      } catch {
        // editor torn down mid-navigation
      }
    },
    [handleRef],
  )

  // Accept all applicable suggestions in ONE round trip: the server flips
  // the selected rows atomically and returns the winners, then the bodies
  // merge into the CRDT locally in id order — each merge re-anchors against
  // the post-merge document, exactly as if the cards were clicked one by
  // one, minus the per-card network wait. Cards hide optimistically while
  // the request is in flight; the broadcast-driven props reload makes the
  // clearing durable, and a failed request lets the cards reappear.
  const [acceptingSuggestionIds, setAcceptingSuggestionIds] = useState<Set<number>>(
    () => new Set(),
  )
  const acceptingAll = acceptingSuggestionIds.size > 0
  const acceptAllSuggestions = useCallback(async () => {
    if (acceptingAll || !handleRef.current) return
    const pending = suggestionsRef.current.filter((s) => s.id > 0)
    if (pending.length === 0) return
    const applicable: SuggestionPayload[] = []
    const blocked: SuggestionPayload[] = []
    for (const suggestion of pending) {
      const result = suggestionApplicability(handleRef.current.editor, suggestion, contentFormat)
      if (result.ok) {
        applicable.push(suggestion)
      } else {
        blocked.push(suggestion)
      }
    }
    if (applicable.length === 0) {
      setSuggestionNotice(skippedSuggestionNotice(blocked.length))
      return
    }
    setSuggestionNotice(null)
    setAcceptingSuggestionIds(new Set(applicable.map((suggestion) => suggestion.id)))
    let succeeded = false
    try {
      const response = await patchJSON(`/d/${slug}/suggestions/accept_all`, {
        by: identityName,
        ids: applicable.map((suggestion) => suggestion.id),
      })
      if (response.ok) {
        const { accepted } = (await response.json()) as { accepted: SuggestionPayload[] }
        // The merge loop is fully synchronous — no await can widen the
        // window in which the live doc diverges between merges. Failed
        // merges collect here and reopen in parallel afterwards (each
        // reopen is an independent PATCH).
        const failedIds: number[] = []
        for (const suggestion of accepted) {
          // Live handle: the editor can remount during the awaits above.
          const live = handleRef.current
          if (!live) {
            failedIds.push(suggestion.id)
            continue
          }
          try {
            const merged = applySuggestion(live.editor, suggestion, contentFormat)
            if (merged) {
              flashMergedRange(live.editor, merged)
            } else {
              failedIds.push(suggestion.id)
            }
          } catch (error) {
            console.warn('pruf: bulk merge failed for suggestion', suggestion.id, error)
            failedIds.push(suggestion.id)
          }
        }
        const reopenResults = await Promise.all(failedIds.map((id) => reopenSuggestion(id)))
        const reopened = reopenResults.filter(Boolean).length
        const reopenFailed = reopenResults.length - reopened
        const notices: string[] = []
        if (blocked.length > 0) {
          notices.push(skippedSuggestionNotice(blocked.length))
        }
        if (reopenFailed > 0) {
          notices.push(
            `${reopenFailed} suggestion${reopenFailed === 1 ? '' : 's'} could not be restored to pending after the document changed. Refresh before reviewing again.`,
          )
        } else if (reopened > 0) {
          notices.push(
            `${reopened} suggestion${reopened === 1 ? '' : 's'} changed before merging and returned to pending.`,
          )
        }
        setSuggestionNotice(notices.length > 0 ? notices.join(' ') : null)
        succeeded = true
      } else {
        console.warn('pruf: accept all rejected', response.status)
      }
    } catch (error) {
      console.warn('pruf: accept all failed', error)
    } finally {
      if (succeeded) {
        // Hold the optimistic clearing until fresh props land — releasing
        // before the reload finishes flashes the accepted cards (and the
        // header button) back for a full round trip. The broadcast-driven
        // debounced reload still covers every other client.
        router.reload({
          only: ['suggestions', 'activities'],
          async: true,
          onFinish: () => setAcceptingSuggestionIds(new Set()),
        })
      } else {
        // Failure: release immediately so the cards reappear (rollback).
        setAcceptingSuggestionIds(new Set())
      }
    }
  }, [acceptingAll, handleRef, slug, contentFormat, identityName, reopenSuggestion])

  // Optimistic clearing for the bulk path: server-backed cards vanish the
  // moment Accept all is clicked; optimistic placeholders (negative ids,
  // not part of the batch) and blocked suggestions stay visible.
  const visibleSuggestions = acceptingAll
    ? suggestions.filter((s) => !acceptingSuggestionIds.has(s.id))
    : suggestions

  const rowItem = useCallback(
    (
      suggestion: SuggestionPayload,
      range: { from: number; to: number } | null,
    ): ReviewableSuggestion => {
      const machine = suggestion.author_kind !== 'human'
      return {
        key: `row-${suggestion.id}`,
        authorName: suggestion.author_name,
        chipKind: suggestion.author_kind,
        glyph: machine ? '✦' : null,
        intent: suggestion.intent,
        oldText: suggestion.replaces,
        newText: suggestion.body,
        canResolve: suggestion.id > 0,
        inline: false,
        markerTitle: `${machine ? '✦ ' : ''}${suggestion.author_name}${suggestion.intent ? ` — ${suggestion.intent}` : ''}`,
        range,
        accept: () => acceptSuggestion(suggestion),
        reject: () => rejectSuggestion(suggestion),
      }
    },
    [acceptSuggestion, rejectSuggestion],
  )

  const items = useMemo<ReviewableSuggestion[]>(() => {
    // Pre-handle, rows render without resolved ranges (cards anchor at the
    // top; counts stay correct) — the docTick recompute heals them the
    // moment the editor binds.
    if (!handle) return visibleSuggestions.map((suggestion) => rowItem(suggestion, null))
    try {
      return handle.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const docSize = view.state.doc.content.size
        const parser = sourceParser(contentFormat, ctx.get(parserCtx), ctx.get(schemaCtx))
        const inline = collectInlineSuggestions(view.state.doc).map(
          (s): ReviewableSuggestion => {
            const author = s.author || 'Someone'
            return {
              key: `inline-${s.id}`,
              authorName: author,
              chipKind: 'human',
              glyph: '✎',
              intent: 'Suggested edit',
              oldText: s.deletedText || null,
              newText: s.insertedText || null,
              canResolve: true,
              inline: true,
              markerTitle: `✎ ${author} suggested an edit`,
              // Positions come from the marks themselves, never text
              // matching, so duplicated text can't mis-anchor a card.
              range: { from: Math.min(s.from, docSize), to: Math.min(s.to, docSize) },
              accept: () => resolveInline(s, true),
              reject: () => resolveInline(s, false),
            }
          },
        )
        const rows = visibleSuggestions.map((suggestion) =>
          rowItem(
            suggestion,
            findSuggestionTarget(
              view.state.doc,
              parser,
              suggestion.replaces ?? suggestion.anchor_text,
              contentFormat,
            ),
          ),
        )
        return [...inline, ...rows]
      })
    } catch {
      // editor torn down mid-navigation
      return visibleSuggestions.map((suggestion) => rowItem(suggestion, null))
    }
    // docTick (local + remote Yjs updates) drives the re-derivation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, docTick, visibleSuggestions, contentFormat, rowItem, resolveInline])

  return {
    items,
    pendingSuggestionCount: visibleSuggestions.filter((s) => s.id > 0).length,
    acceptAllSuggestions,
    acceptingAll,
    suggestionNotice,
    setSuggestionNotice,
  }
}
