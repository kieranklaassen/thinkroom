import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewOptionsCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { DOMSerializer, Fragment, Slice, type Node } from '@milkdown/kit/prose/model'
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
