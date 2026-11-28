import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { firstHeadingTitle } from './document_title'
import { collectSpans, type ProvenanceSpan } from './provenance'
import type { SelectionCallback } from './selection_watcher'

export interface ChangeCallbacks {
  onSpans?: (spans: ProvenanceSpan[]) => void
  onSelection?: SelectionCallback
  onTitleChange?: (title: string) => void
}

/**
 * Tells the page about spans, selection and title. Callbacks are read when a
 * report fires, so a report scheduled before a render uses the newer ones.
 */
export function createChangeReporter(callbacks: () => ChangeCallbacks) {
  let spansFrame = 0

  const reportSpans = (view: EditorView) =>
    callbacks().onSpans?.(collectSpans(view.state.doc, { excludePendingInsertions: true }))

  const reportTitle = (doc: ProseNode) => {
    const title = firstHeadingTitle(doc)
    if (title) callbacks().onTitleChange?.(title)
  }

  const reportSelection: SelectionCallback = (view, cause) => {
    // Once per frame, with the page's other per-edit updates: a
    // synchronous push rendered the page an extra time per keystroke.
    if (cause === 'document' && !spansFrame) {
      spansFrame = requestAnimationFrame(() => {
        spansFrame = 0
        reportSpans(view)
      })
    }
    callbacks().onSelection?.(view, cause)
  }

  const cancelPending = () => {
    if (spansFrame) cancelAnimationFrame(spansFrame)
  }

  return { reportSpans, reportTitle, reportSelection, cancelPending }
}
