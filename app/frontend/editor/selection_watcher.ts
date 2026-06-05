import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

export type SelectionCallback = (view: EditorView) => void

/** React registers a callback here to observe selection/doc changes. */
export const selectionCallbackCtx = $ctx<{ fn: SelectionCallback | null }, 'selectionCallback'>(
  { fn: null },
  'selectionCallback',
)

const selectionWatcherProse = $prose((ctx) => {
  return new Plugin({
    key: new PluginKey('SELECTION_WATCHER'),
    view: () => ({
      update: (view, prevState) => {
        if (
          prevState &&
          prevState.doc.eq(view.state.doc) &&
          prevState.selection.eq(view.state.selection)
        ) {
          return
        }
        ctx.get(selectionCallbackCtx.key).fn?.(view)
      },
    }),
  })
})

export const selectionWatcher = [selectionCallbackCtx, selectionWatcherProse].flat()
