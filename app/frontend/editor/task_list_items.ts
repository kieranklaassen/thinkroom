import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { $ctx, $prose, $view } from '@milkdown/kit/utils'

export const taskPersistenceCtx = $ctx<{ persist: (() => void) | null }, 'taskPersistence'>(
  { persist: null },
  'taskPersistence',
)

function syncListItemAttributes(dom: HTMLLIElement, node: Node): void {
  dom.dataset.label = String(node.attrs.label)
  dom.dataset.listType = String(node.attrs.listType)
  dom.dataset.spread = String(node.attrs.spread)

  if (node.attrs.checked == null) {
    delete dom.dataset.itemType
    delete dom.dataset.checked
  } else {
    dom.dataset.itemType = 'task'
    dom.dataset.checked = String(node.attrs.checked)
  }
}

function plainListItemView(initialNode: Node): NodeView {
  const dom = document.createElement('li')
  syncListItemAttributes(dom, initialNode)

  return {
    dom,
    contentDOM: dom,
    update: (node) => {
      if (node.type !== initialNode.type || node.attrs.checked != null) return false
      syncListItemAttributes(dom, node)
      return true
    },
  }
}

function taskListItemView(
  initialNode: Node,
  view: EditorView,
  getPos: () => number | undefined,
  persist: () => void,
): NodeView {
  const dom = document.createElement('li')
  const control = document.createElement('span')
  const checkbox = document.createElement('input')
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const check = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  const contentDOM = document.createElement('div')

  control.className = 'task-checkbox-control'
  control.contentEditable = 'false'

  checkbox.className = 'task-checkbox'
  checkbox.type = 'checkbox'
  checkbox.name = 'task-complete'

  icon.classList.add('task-checkbox-icon')
  icon.setAttribute('viewBox', '0 0 14 14')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('fill', 'none')
  check.setAttribute('d', 'M3 7.5 5.75 10.25 11 3.75')
  check.setAttribute('stroke-width', '2')
  check.setAttribute('stroke-linecap', 'round')
  check.setAttribute('stroke-linejoin', 'round')
  icon.appendChild(check)

  contentDOM.className = 'task-item-content'
  control.append(checkbox, icon)
  dom.append(control, contentDOM)

  let currentNode = initialNode
  const sync = (node: Node) => {
    currentNode = node
    syncListItemAttributes(dom, node)
    checkbox.checked = node.attrs.checked === true
    checkbox.disabled = !view.editable
    checkbox.setAttribute(
      'aria-label',
      checkbox.checked ? 'Mark task incomplete' : 'Mark task complete',
    )
  }

  const onChange = () => {
    const pos = getPos()
    if (pos == null || !view.editable) {
      sync(currentNode)
      return
    }

    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...currentNode.attrs,
        checked: checkbox.checked,
      }),
    )
    persist()
  }

  checkbox.addEventListener('change', onChange)
  sync(initialNode)

  return {
    dom,
    contentDOM,
    update: (node) => {
      if (node.type !== initialNode.type || node.attrs.checked == null) return false
      sync(node)
      return true
    },
    stopEvent: (event) => event.target instanceof globalThis.Node && control.contains(event.target),
    ignoreMutation: (mutation) => {
      if (mutation.type === 'selection') return false
      return !contentDOM.contains(mutation.target)
    },
    destroy: () => checkbox.removeEventListener('change', onChange),
  }
}

const taskListItemNodeView = $view(
  extendListItemSchemaForTask.node,
  (ctx): NodeViewConstructor => (node, view, getPos) => {
    if (node.attrs.checked == null) return plainListItemView(node)
    return taskListItemView(node, view, getPos, () => {
      ctx.get(taskPersistenceCtx.key).persist?.()
    })
  },
)

// Mode changes do not recreate node views. Keep the native controls' disabled
// state aligned with ProseMirror's live editable setting on every view update.
const taskListEditability = $prose(
  () =>
    new Plugin({
      view: (view) => {
        const sync = () => {
          view.dom.querySelectorAll<HTMLInputElement>('.task-checkbox').forEach((checkbox) => {
            checkbox.disabled = !view.editable
          })
        }
        sync()
        return { update: sync }
      },
    }),
)

export const interactiveTaskListItems = [
  taskPersistenceCtx,
  taskListItemNodeView,
  taskListEditability,
].flat()
