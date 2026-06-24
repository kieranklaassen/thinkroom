import type { Node } from '@milkdown/kit/prose/model'
import type { NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { $ctx, $prose, $view } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import { dataFromSketchNode, sketchSchema } from './schema'
import { renderSketchPreview } from './preview'
import { sketchAccessibleLabel, type SketchData } from './scene'

interface SketchControls {
  edit: (data: SketchData) => void
  enabled: () => boolean
}

export const sketchControlsCtx = $ctx<SketchControls, 'sketchControls'>(
  { edit: () => undefined, enabled: () => false },
  'sketchControls',
)

const buildSketchView = (
  initialNode: Node,
  edit: (data: SketchData) => void,
  enabled: () => boolean,
): NodeView => {
  const dom = document.createElement('figure')
  const preview = document.createElement('div')
  const caption = document.createElement('figcaption')
  let currentData = dataFromSketchNode(initialNode)
  let renderedScene = ''
  let renderedDescription = ''

  dom.className = 'thinkroom-sketch'
  dom.contentEditable = 'false'
  preview.className = 'thinkroom-sketch-preview'
  caption.className = 'thinkroom-sketch-caption'
  dom.append(preview, caption)

  const syncInteractivity = () => {
    const interactive = enabled()
    dom.classList.toggle('is-editable', interactive)
    if (interactive) {
      dom.setAttribute('role', 'button')
      dom.tabIndex = 0
      dom.title = 'Edit sketch'
    } else {
      dom.removeAttribute('role')
      dom.removeAttribute('tabindex')
      dom.removeAttribute('title')
    }
  }

  const render = (node: Node) => {
    currentData = dataFromSketchNode(node)
    if (!currentData) {
      preview.replaceChildren()
      caption.textContent = 'Invalid sketch'
      return
    }
    const scene = node.attrs.scene as string
    const description = currentData.description
    if (scene !== renderedScene || description !== renderedDescription) {
      preview.replaceChildren(renderSketchPreview(currentData.scene))
      caption.textContent = description || 'Sketch'
      renderedScene = scene
      renderedDescription = description
    }
    dom.setAttribute('aria-label', sketchAccessibleLabel(currentData))
    dom.dataset.sketchId = currentData.id
    syncInteractivity()
  }

  const open = () => {
    if (currentData && enabled()) edit(currentData)
  }
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0) return
    open()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open()
  }

  dom.addEventListener('click', onClick)
  dom.addEventListener('keydown', onKeyDown)
  render(initialNode)

  return {
    dom,
    update: (node) => {
      if (node.type !== initialNode.type) return false
      render(node)
      return true
    },
    selectNode: () => dom.classList.add('is-selected'),
    deselectNode: () => dom.classList.remove('is-selected'),
    stopEvent: (event) => event.target instanceof globalThis.Node && dom.contains(event.target),
    ignoreMutation: () => true,
    destroy: () => {
      dom.removeEventListener('click', onClick)
      dom.removeEventListener('keydown', onKeyDown)
    },
  }
}

const sketchNodeView = $view(
  sketchSchema.node,
  (ctx): NodeViewConstructor => (node) =>
    buildSketchView(
      node,
      (data) => ctx.get(sketchControlsCtx.key).edit(data),
      () => ctx.get(sketchControlsCtx.key).enabled(),
    ),
)

const sketchInteractivity = $prose(
  (ctx) =>
    new Plugin({
      view: (view) => {
        const sync = () => {
          const enabled = ctx.get(sketchControlsCtx.key).enabled()
          view.dom.querySelectorAll<HTMLElement>('.thinkroom-sketch').forEach((node) => {
            node.classList.toggle('is-editable', enabled)
            if (enabled) {
              node.setAttribute('role', 'button')
              node.tabIndex = 0
              node.title = 'Edit sketch'
            } else {
              node.removeAttribute('role')
              node.removeAttribute('tabindex')
              node.removeAttribute('title')
            }
          })
        }
        sync()
        return { update: sync }
      },
    }),
)

export const sketchNodeViewPlugins = [sketchControlsCtx, sketchNodeView, sketchInteractivity].flat()
