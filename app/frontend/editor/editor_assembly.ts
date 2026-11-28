import { Editor, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core'
import { tableBlock, tableBlockConfig } from '@milkdown/kit/component/table-block'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { indent } from '@milkdown/kit/plugin/indent'
import { listener } from '@milkdown/kit/plugin/listener'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import { collab } from '@milkdown/plugin-collab'
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight'
import { agentCursors } from './agent_cursors'
import type { RenderHints } from './cable_provider'
import { configureCleanClipboard } from './clipboard'
import { codeBlockView } from './code_block_view'
import { sanitizeHtml } from './document_format'
import { documentSizeGuard, documentSizeGuardCtx } from './document_size_guard'
import { frontmatter } from './frontmatter'
import { lazyShikiParser } from './highlighter'
import { renderSoftBreaks } from './line_breaks'
import { openEditorLink } from './link_opening'
import { longDocument } from './long_document'
import { mermaidDiagrams, mermaidRenderHintsCtx } from './mermaid'
import { provenance, provenanceIdentityCtx } from './provenance'
import { readPointers } from './read_pointers'
import { richBlockWidthControls } from './rich_block_width'
import { markdownPresets } from './schema_attributes'
import { scrollSettle } from './scroll_settle'
import { selectionWatcher } from './selection_watcher'
import { sketchControlsCtx, sketchNodeViewPlugins, sketchSchemaPlugins } from './sketch'
import type { SketchControls } from './sketch/node_view'
import { configureSlashMenu, slashMenu } from './slash_menu'
import { suggestChangesMarks } from './suggest_changes'
import { suggestDispatch, suggestState } from './suggest_changes/intercept'
import { suggestGuard } from './suggest_changes/normalize'
import { tableButtonIcon } from './table_icons'
import { interactiveTaskListItems } from './task_list_items'
import { textHighlighter } from './text_highlighter'
import { imageUploader } from './upload'

interface EditorAssembly {
  root: HTMLElement
  authorName: string
  mermaidHints: RenderHints['mermaid']
  /** Read at call time, like `sketchControls`: both change while the editor lives. */
  editable: () => boolean
  sketchControls: () => SketchControls
  onEditRefused: () => void
}

/** The document editor's configuration and plugins, in registration order. */
export function assembleEditor({
  root,
  authorName,
  mermaidHints,
  editable,
  sketchControls,
  onEditRefused,
}: EditorAssembly): Editor {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(provenanceIdentityCtx.key, { name: authorName })
      ctx.set(mermaidRenderHintsCtx.key, mermaidHints ?? {})
      ctx.update(documentSizeGuardCtx.key, (prev) => ({ ...prev, onRefused: onEditRefused }))
      ctx.set(sketchControlsCtx.key, {
        edit: (data, mount, wrapper) => sketchControls().edit(data, mount, wrapper),
        save: (data) => sketchControls().save(data),
        insert: () => sketchControls().insert(),
        delete: (id) => sketchControls().delete(id),
        close: (id) => sketchControls().close(id),
        enabled: () => sketchControls().enabled(),
      })
      // Read-only modes gate USER input only — ProseMirror still accepts
      // programmatic transactions (Yjs sync, seeding, suggestion accept).
      // dispatchTransaction is the suggest-changes wrapper: a pass-through
      // unless the suggestState plugin says suggesting is enabled, with
      // remote/undo/resolve transactions never re-intercepted.
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable,
        dispatchTransaction: suggestDispatch,
        transformPastedHTML: (html) => sanitizeHtml(html, 'external'),
        handleDOMEvents: {
          ...prev.handleDOMEvents,
          click: (view, event) =>
            prev.handleDOMEvents?.click?.(view, event) || openEditorLink(view, event),
        },
      }))
      ctx.update(highlightPluginConfig.key, (prev) => ({
        ...prev,
        parser: lazyShikiParser(),
        languageExtractor: (node) => (node.attrs.language as string) ?? '',
      }))
      ctx.update(uploadConfig.key, (prev) => ({
        ...prev,
        uploader: imageUploader(authorName),
        enableHtmlFileUploader: true,
      }))
      configureCleanClipboard(ctx)
      configureSlashMenu(ctx)
      renderSoftBreaks(ctx)
      // The defaults are bare text ('+', 'left', …) — real icons required.
      ctx.update(tableBlockConfig.key, (prev) => ({ ...prev, renderButton: tableButtonIcon }))
    })
    .use(markdownPresets)
    .use(codeBlockView)
    .use(interactiveTaskListItems)
    .use(tableBlock)
    .use(listener)
    .use(clipboard)
    .use(cursor)
    .use(indent)
    .use(trailing)
    .use(highlight)
    .use(mermaidDiagrams)
    .use(upload)
    .use(provenance)
    .use(textHighlighter)
    .use(frontmatter)
    .use(sketchSchemaPlugins)
    .use(sketchNodeViewPlugins)
    .use(richBlockWidthControls)
    .use(slashMenu)
    .use(suggestChangesMarks)
    // Order matters: provenanceWriter (inside provenance) runs its
    // appendTransaction before suggestGuard's — the guard observes
    // already-attributed text (KTD 6 registration order).
    .use(suggestState)
    .use(suggestGuard)
    .use(documentSizeGuard)
    .use(selectionWatcher)
    .use(agentCursors)
    .use(readPointers)
    .use(scrollSettle)
    .use(longDocument)
    .use(collab)
}
