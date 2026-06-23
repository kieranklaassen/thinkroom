import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewOptionsCtx } from '@milkdown/kit/core'
import { Fragment, Slice, type Node } from '@milkdown/kit/prose/model'
import { SUGGESTION_MARK_NAMES } from './suggest_changes/marks'

const ACTIVITY_MARK_NAMES = new Set(['provenance', ...SUGGESTION_MARK_NAMES])

function stripActivityMarks(fragment: Fragment): Fragment {
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
 * Remove Pruf-only activity marks before ProseMirror produces either its
 * Markdown text flavor or rich HTML flavor, while preserving normal marks
 * such as emphasis, links, code, and strikethrough.
 */
export function configureCleanClipboard(ctx: Ctx): void {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
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
