import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { suggestChangesKey } from '@handlewithcare/prosemirror-suggest-changes'
import { SKIP_PROVENANCE } from '../provenance'
import { attrsFromSketchData } from './schema'
import type { SketchData } from './scene'

/**
 * Document-level sketch operations. Sketch writes skip both provenance and
 * the suggest-changes interceptor — scene JSON must never be wrapped in
 * attribution or tracked-edit marks. Each returns whether a transaction was
 * dispatched so callers know when to persist.
 */

export function upsertSketchNode(
  view: EditorView,
  data: SketchData,
  activate = false,
): boolean {
  const type = view.state.schema.nodes.thinkroomSketch
  if (!type) return false

  let existingPos: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (node.type === type && node.attrs.id === data.id) {
      existingPos = pos
      return false
    }
    return existingPos === null
  })

  const attrs = attrsFromSketchData(data)
  const tr =
    existingPos === null
      ? view.state.tr.replaceSelectionWith(type.create(attrs)).scrollIntoView()
      : view.state.tr.setNodeMarkup(existingPos, type, attrs)
  tr.setMeta(SKIP_PROVENANCE, true)
  tr.setMeta(suggestChangesKey, { skip: true })
  view.dispatch(tr)

  if (activate) {
    requestAnimationFrame(() => {
      const sketch = view.dom.querySelector<HTMLElement>(
        `.thinkroom-sketch[data-sketch-id="${data.id}"]`,
      )
      sketch?.click()
    })
  }
  return true
}

export function deleteSketchNode(view: EditorView, id: string): boolean {
  const type = view.state.schema.nodes.thinkroomSketch
  if (!type) return false

  let targetPos = -1
  let targetSize = 0
  view.state.doc.descendants((node, pos) => {
    if (node.type === type && node.attrs.id === id) {
      targetPos = pos
      targetSize = node.nodeSize
      return false
    }
    return targetPos < 0
  })
  if (targetPos < 0) return false

  const tr = view.state.tr.delete(targetPos, targetPos + targetSize).scrollIntoView()
  tr.setMeta(SKIP_PROVENANCE, true)
  tr.setMeta(suggestChangesKey, { skip: true })
  view.dispatch(tr)
  return true
}

/** Place the caret just after the sketch node and refocus the editor. */
export function focusAfterSketchNode(view: EditorView, id: string): void {
  const type = view.state.schema.nodes.thinkroomSketch
  if (!type) return
  let after = -1
  view.state.doc.descendants((node, pos) => {
    if (node.type === type && node.attrs.id === id) {
      after = pos + node.nodeSize
      return false
    }
    return after < 0
  })
  if (after < 0) return
  const nextNode = view.state.doc.nodeAt(after)
  const textPosition = nextNode?.isTextblock ? after + 1 : after
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, textPosition))
  view.dispatch(tr.scrollIntoView())
  requestAnimationFrame(() => view.focus())
}
