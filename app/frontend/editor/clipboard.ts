import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx, editorViewOptionsCtx, schemaCtx, serializerCtx, type Editor } from '@milkdown/kit/core'
import { DOMSerializer, Fragment, Slice, type Node } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  containsSketch,
  portableClipboardSerializer,
  serializePortableMarkdownSync,
} from './sketch/portable'
import { SUGGESTION_MARK_NAMES } from './suggest_changes/marks'

const ACTIVITY_MARK_NAMES = new Set(['provenance', ...SUGGESTION_MARK_NAMES])

type ClipboardNodeJson = { type?: string; content?: ClipboardNodeJson[] }

const isPureText = (content: ClipboardNodeJson | ClipboardNodeJson[]): boolean => {
  if (Array.isArray(content)) return content.length === 1 && isPureText(content[0])
  if (content.content) return isPureText(content.content)
  return content.type === 'text'
}

export function stripActivityMarks(fragment: Fragment): Fragment {
  const children: Node[] = []

  fragment.forEach((node) => {
    const content = node.content.size > 0 ? stripActivityMarks(node.content) : node.content
    const marks = node.marks.filter((mark) => !ACTIVITY_MARK_NAMES.has(mark.type.name))
    children.push(node.copy(content).mark(marks))
  })

  return Fragment.fromArray(children)
}

/**
 * Clipboard content is an export surface, not a collaboration snapshot.
 * Remove Thinkroom-only activity marks before ProseMirror produces either its
 * Markdown text flavor or rich HTML flavor, while preserving normal marks
 * such as emphasis, links, code, and strikethrough.
 */
export function configureCleanClipboard(ctx: Ctx): void {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    // Schema and serializer contexts are not ready during Editor.config.
    // Resolve them only when the browser actually serializes a copy event.
    clipboardSerializer: {
      serializeFragment: (
        fragment: Fragment,
        options?: { document?: Document },
        target?: HTMLElement | DocumentFragment,
      ) => {
        const schema = ctx.get(schemaCtx)
        const serializer = portableClipboardSerializer(
          schema,
          prev.clipboardSerializer ?? DOMSerializer.fromSchema(schema),
        )
        return serializer.serializeFragment(fragment, options, target)
      },
    } as DOMSerializer,
    clipboardTextSerializer: (slice, view) => {
      const schema = ctx.get(schemaCtx)
      const markdownSerializer = ctx.get(serializerCtx)
      const document = schema.topNodeType.createAndFill(undefined, slice.content)
      if (!document) return ''
      if (!containsSketch(document)) {
        if (prev.clipboardTextSerializer) return prev.clipboardTextSerializer(slice, view)
        if (isPureText(slice.content.toJSON() as ClipboardNodeJson)) {
          return slice.content.textBetween(0, slice.content.size, '\n\n')
        }
        return markdownSerializer(document)
      }
      return serializePortableMarkdownSync(document, schema, markdownSerializer)
    },
    transformCopied: (slice, view) => {
      const transformed = prev.transformCopied?.(slice, view) ?? slice
      return new Slice(
        stripActivityMarks(transformed.content),
        transformed.openStart,
        transformed.openEnd,
      )
    },
  }))
}

/**
 * Read and Comment mode render the editor with `editable: false`, so
 * ProseMirror never owns the DOM selection and a native copy serializes the
 * raw live DOM — provenance spans, sketch scene internals, width handles and
 * all. This document-level listener maps the native selection back to
 * document positions and routes it through the same transformCopied /
 * clipboardSerializer / clipboardTextSerializer chain an editable view uses,
 * so copying while reading produces the identical clean flavors.
 */
export function bindReadModeCopy(editor: Editor): () => void {
  let view: EditorView | null = null
  editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  if (!view) return () => undefined
  const editorView = view as EditorView

  const positionAt = (container: globalThis.Node, offset: number, fallback: number): number => {
    if (!editorView.dom.contains(container)) return fallback
    try {
      return editorView.posAtDOM(container, offset)
    } catch {
      return fallback
    }
  }

  const onCopy = (event: ClipboardEvent) => {
    if (editorView.editable || !event.clipboardData) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    // A selection wholly outside the document (sidebar, header) stays native;
    // one that spans past the document is clamped to the document's edges.
    if (!range.intersectsNode(editorView.dom)) return

    const docSize = editorView.state.doc.content.size
    let from = positionAt(range.startContainer, range.startOffset, 0)
    let to = positionAt(range.endContainer, range.endOffset, docSize)
    if (from > to) [from, to] = [to, from]
    if (from === to) return

    let slice = editorView.state.doc.slice(from, to)
    slice = editorView.someProp('transformCopied', (transform) => transform(slice, editorView)) ?? slice

    const serializer =
      editorView.someProp('clipboardSerializer') ?? DOMSerializer.fromSchema(editorView.state.schema)
    const container = document.createElement('div')
    serializer.serializeFragment(slice.content, { document }, container)

    const text =
      editorView.someProp('clipboardTextSerializer', (serialize) => serialize(slice, editorView)) ??
      slice.content.textBetween(0, slice.content.size, '\n\n')

    event.clipboardData.setData('text/html', container.innerHTML)
    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
  }

  document.addEventListener('copy', onCopy)
  return () => document.removeEventListener('copy', onCopy)
}
