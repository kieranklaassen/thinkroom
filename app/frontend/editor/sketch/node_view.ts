import type { Node } from '@milkdown/kit/prose/model'
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
  type NodeViewConstructor,
} from '@milkdown/kit/prose/view'
import { $ctx, $prose, $view } from '@milkdown/kit/utils'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { attrsFromSketchData, dataFromSketchNode, sketchSchema } from './schema'
import { downloadSketchSvg } from './export'
import {
  fitSketchViewport,
  renderExactSketchPreview,
  renderSketchPreview,
  storedSketchViewport,
} from './preview'
import {
  EMPTY_SKETCH_SCENE,
  DEFAULT_SKETCH_HEIGHT,
  MAX_SKETCH_DESCRIPTION,
  sketchAccessibleLabel,
  type SketchData,
} from './scene'

interface SketchControls {
  edit: (data: SketchData, mount: HTMLElement, wrapper: HTMLElement) => void
  save: (data: SketchData) => void
  insert: () => void
  delete: (id: string) => void
  close: (id: string) => void
  enabled: () => boolean
}

const syncSketchInteractivity = (dom: HTMLElement, interactive: boolean) => {
  const caption = dom.querySelector<HTMLElement>('.thinkroom-sketch-caption')
  const title = dom.querySelector<HTMLInputElement>('.thinkroom-sketch-title')
  const deleteButton = dom.querySelector<HTMLButtonElement>('.sketch-delete-tape')
  dom.classList.toggle('is-editable', interactive)
  caption?.classList.toggle('is-editable', interactive)
  if (title) {
    title.readOnly = !interactive
    title.tabIndex = interactive ? 0 : -1
    title.placeholder = interactive ? 'Add a title…' : ''
  }
  if (deleteButton) deleteButton.hidden = !interactive
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

export const sketchControlsCtx = $ctx<SketchControls, 'sketchControls'>(
  {
    edit: () => undefined,
    save: () => undefined,
    insert: () => undefined,
    delete: () => undefined,
    close: () => undefined,
    enabled: () => false,
  },
  'sketchControls',
)

const buildSketchView = (
  initialNode: Node,
  edit: (data: SketchData, mount: HTMLElement, wrapper: HTMLElement) => void,
  save: (data: SketchData) => void,
  remove: (id: string) => void,
  close: (id: string) => void,
  enabled: () => boolean,
): NodeView => {
  const dom = document.createElement('figure')
  const preview = document.createElement('div')
  const caption = document.createElement('figcaption')
  const titleInput = document.createElement('input')
  const editorMount = document.createElement('div')
  const deleteButton = document.createElement('button')
  const downloadButton = document.createElement('button')
  let currentData = dataFromSketchNode(initialNode)
  let displayData = currentData
  let renderedScene = ''
  let renderedDescription = ''
  let titleTimer: ReturnType<typeof setTimeout> | null = null
  let previewGeneration = 0
  let destroyed = false
  let lastPreviewWidth = 0
  let renderedTapeId = ''
  let downloadResetTimer: ReturnType<typeof setTimeout> | null = null

  const syncTapeVariation = (id: string) => {
    const hash = Array.from(id).reduce(
      (value, character) => Math.imul(value ^ character.charCodeAt(0), 16_777_619) >>> 0,
      2_166_136_261,
    )
    dom.style.setProperty('--sketch-tape-width', `${86 + (hash % 23)}px`)
    dom.style.setProperty('--sketch-tape-offset', `${((hash >>> 8) % 21) - 10}px`)
    dom.style.setProperty('--sketch-tape-angle', `${(((hash >>> 16) % 29) - 14) / 10}deg`)
  }

  dom.className = 'thinkroom-sketch'
  dom.contentEditable = 'false'
  preview.className = 'thinkroom-sketch-preview'
  caption.className = 'thinkroom-sketch-caption'
  titleInput.className = 'thinkroom-sketch-title'
  titleInput.type = 'text'
  titleInput.maxLength = MAX_SKETCH_DESCRIPTION
  titleInput.setAttribute('aria-label', 'Sketch title')
  caption.append(titleInput)
  editorMount.className = 'thinkroom-sketch-editor-mount'
  deleteButton.className = 'sketch-delete-tape'
  deleteButton.type = 'button'
  deleteButton.textContent = '×'
  deleteButton.contentEditable = 'false'
  deleteButton.setAttribute('aria-label', 'Delete sketch')
  downloadButton.className = 'sketch-download-button'
  downloadButton.type = 'button'
  downloadButton.textContent = 'Download'
  downloadButton.contentEditable = 'false'
  downloadButton.setAttribute('aria-label', 'Download sketch as SVG')
  dom.append(preview, editorMount, caption, downloadButton, deleteButton)

  const renderExactPreview = (data: SketchData, generation: number) => {
    // ProseMirror attaches the node view before the microtask queue drains.
    // Measure and render there so the exact Excalidraw SVG replaces the
    // fallback before the browser's first paint, without waiting for rAF.
    queueMicrotask(() => {
      if (destroyed || generation !== previewGeneration) return
      const width = Math.max(1, preview.clientWidth || dom.clientWidth || 640)
      lastPreviewWidth = width
      const storedViewport = storedSketchViewport(data.scene, width, data.height)
      const viewport = storedViewport ?? fitSketchViewport(data.scene, width, data.height)
      displayData = storedViewport
        ? data
        : {
            ...data,
            height: viewport.height,
            scene: {
              ...data.scene,
              appState: {
                ...data.scene.appState,
                scrollX: viewport.scrollX,
                scrollY: viewport.scrollY,
                zoom: { value: viewport.zoom },
              },
            },
          },
      preview.style.height = `${viewport.height}px`
      void renderExactSketchPreview(data.scene, width, viewport).then((exactPreview) => {
        if (!destroyed && exactPreview && generation === previewGeneration) {
          preview.replaceChildren(exactPreview)
        }
      }).catch(() => {
        // Keep the safe lightweight preview if exact SVG generation fails.
      })
    })
  }

  const resizeObserver = new ResizeObserver(() => {
    if (!currentData || preview.clientWidth === 0 || preview.clientWidth === lastPreviewWidth) return
    const generation = ++previewGeneration
    renderExactPreview(currentData, generation)
  })
  resizeObserver.observe(preview)

  const syncInteractivity = () => {
    syncSketchInteractivity(dom, enabled())
  }

  const render = (node: Node) => {
    currentData = dataFromSketchNode(node)
    if (!currentData) {
      preview.replaceChildren()
      titleInput.value = 'Invalid sketch'
      titleInput.readOnly = true
      downloadButton.hidden = true
      return
    }
    downloadButton.hidden = false
    const scene = node.attrs.scene as string
    if (scene !== renderedScene) displayData = currentData
    const description = currentData.description
    preview.style.height = `${currentData.height}px`
    if (scene !== renderedScene) {
      preview.replaceChildren(renderSketchPreview(currentData.scene))
      const generation = ++previewGeneration
      // Reuse the exact editor viewport when it contains the whole scene;
      // legacy, agent-authored, or edge-clipped scenes are safely fitted.
      renderExactPreview(currentData, generation)
      renderedScene = scene
    }
    if (description !== renderedDescription) {
      if (displayData) displayData = { ...displayData, description }
      if (document.activeElement !== titleInput) titleInput.value = description
      caption.classList.toggle('is-empty', description.length === 0)
      renderedDescription = description
    }
    dom.setAttribute('aria-label', sketchAccessibleLabel(currentData))
    dom.dataset.sketchId = currentData.id
    if (currentData.id !== renderedTapeId) {
      syncTapeVariation(currentData.id)
      renderedTapeId = currentData.id
    }
    syncInteractivity()
  }

  const open = () => {
    if (displayData && enabled()) {
      const layoutChanged = currentData && (
        currentData.height !== displayData.height ||
        JSON.stringify(currentData.scene) !== JSON.stringify(displayData.scene)
      )
      currentData = displayData
      if (layoutChanged) save(displayData)
      edit(displayData, editorMount, dom)
    }
  }
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0) return
    if (
      event.target instanceof globalThis.Node &&
      (editorMount.contains(event.target) || caption.contains(event.target) || !event.target.isConnected)
    ) return
    open()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.target instanceof globalThis.Node &&
      (editorMount.contains(event.target) || caption.contains(event.target))
    ) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open()
  }

  dom.addEventListener('click', onClick)
  dom.addEventListener('keydown', onKeyDown)
  const onDelete = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (currentData && enabled()) remove(currentData.id)
  }
  deleteButton.addEventListener('click', onDelete)
  const resetDownloadButton = () => {
    downloadResetTimer = null
    downloadButton.disabled = false
    downloadButton.textContent = 'Download'
    downloadButton.setAttribute('aria-label', 'Download sketch as SVG')
  }
  const onDownload = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!currentData || downloadButton.disabled) return
    if (downloadResetTimer) clearTimeout(downloadResetTimer)
    downloadButton.disabled = true
    downloadButton.textContent = 'Preparing…'
    void downloadSketchSvg(currentData.scene, currentData.description || 'sketch')
      .then(() => {
        downloadButton.textContent = 'Downloaded'
        downloadButton.setAttribute('aria-label', 'Sketch downloaded as SVG')
        downloadResetTimer = setTimeout(resetDownloadButton, 1600)
      })
      .catch((error) => {
        console.warn('thinkroom: sketch export failed', error)
        downloadButton.disabled = false
        downloadButton.textContent = 'Retry'
        downloadButton.setAttribute('aria-label', 'Sketch export failed. Retry download')
      })
  }
  downloadButton.addEventListener('click', onDownload)
  const saveTitle = () => {
    if (!displayData || !enabled()) return
    if (titleTimer) clearTimeout(titleTimer)
    titleTimer = null
    currentData = { ...displayData, description: titleInput.value }
    displayData = currentData
    caption.classList.toggle('is-empty', titleInput.value.length === 0)
    save(currentData)
  }
  const onTitleInput = () => {
    caption.classList.toggle('is-empty', titleInput.value.length === 0)
    if (displayData) {
      currentData = { ...displayData, description: titleInput.value }
      displayData = currentData
    }
    if (titleTimer) clearTimeout(titleTimer)
    titleTimer = setTimeout(saveTitle, 300)
  }
  titleInput.addEventListener('input', onTitleInput)
  titleInput.addEventListener('blur', saveTitle)
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
      destroyed = true
      previewGeneration += 1
      resizeObserver.disconnect()
      dom.removeEventListener('click', onClick)
      dom.removeEventListener('keydown', onKeyDown)
      titleInput.removeEventListener('input', onTitleInput)
      titleInput.removeEventListener('blur', saveTitle)
      deleteButton.removeEventListener('click', onDelete)
      downloadButton.removeEventListener('click', onDownload)
      if (titleTimer) clearTimeout(titleTimer)
      if (downloadResetTimer) clearTimeout(downloadResetTimer)
      if (currentData) close(currentData.id)
    },
  }
}

const sketchNodeView = $view(
  sketchSchema.node,
  (ctx): NodeViewConstructor => (node) =>
    buildSketchView(
      node,
      (data, mount, wrapper) => ctx.get(sketchControlsCtx.key).edit(data, mount, wrapper),
      (data) => ctx.get(sketchControlsCtx.key).save(data),
      (id) => ctx.get(sketchControlsCtx.key).delete(id),
      (id) => ctx.get(sketchControlsCtx.key).close(id),
      () => ctx.get(sketchControlsCtx.key).enabled(),
    ),
)

const sketchInteractivity = $prose(
  (ctx) =>
    new Plugin({
      view: (view) => {
        const sync = () => {
          const enabled = ctx.get(sketchControlsCtx.key).enabled()
          if (!enabled) {
            view.dom.querySelectorAll<HTMLElement>('.thinkroom-sketch[data-sketch-id]').forEach((node) => {
              if (node.dataset.sketchId) ctx.get(sketchControlsCtx.key).close(node.dataset.sketchId)
            })
          }
          view.dom.querySelectorAll<HTMLElement>('.thinkroom-sketch').forEach((node) => {
            syncSketchInteractivity(node, enabled)
          })
        }
        sync()
        return { update: sync }
      },
    }),
)

const newSketchData = (): SketchData => ({
  id: crypto.randomUUID(),
  formatVersion: 1,
  description: '',
  height: DEFAULT_SKETCH_HEIGHT,
  scene: structuredClone(EMPTY_SKETCH_SCENE),
})

const activateSketch = (view: EditorView, id: string) => {
  requestAnimationFrame(() => {
    view.dom.querySelector<HTMLElement>(`.thinkroom-sketch[data-sketch-id="${id}"]`)?.click()
  })
}

const sketchInsertAffordance = $prose(
  (ctx) =>
    new Plugin({
      props: {
        decorations: (state) => {
          const last = state.doc.lastChild
          if (!ctx.get(sketchControlsCtx.key).enabled() || !last?.isTextblock || last.content.size > 0) {
            return null
          }
          return DecorationSet.create(state.doc, [
            Decoration.widget(state.doc.content.size, (view) => {
              const button = document.createElement('button')
              button.type = 'button'
              button.className = 'sketch-add-inline'
              button.textContent = '+ Add sketch'
              button.contentEditable = 'false'
              button.addEventListener('mousedown', (event) => event.preventDefault())
              button.addEventListener('click', () => {
                view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
                ctx.get(sketchControlsCtx.key).insert()
              })
              return button
            }, { key: 'thinkroom-add-sketch', side: 1 }),
          ])
        },
      },
    }),
)

const sketchSlashCommand = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleTextInput: (view, from, _to, text) => {
          if (!ctx.get(sketchControlsCtx.key).enabled()) return false
          const $from = view.state.doc.resolve(from)
          if ($from.depth !== 1 || !$from.parent.isTextblock) return false
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc') + text
          if (before !== '/sketch') return false

          const data = newSketchData()
          const type = view.state.schema.nodes.thinkroomSketch
          const paragraph = view.state.schema.nodes.paragraph
          if (!type || !paragraph) return false
          const blockPos = $from.before(1)
          const tr = view.state.tr.replaceWith(
            blockPos,
            blockPos + $from.parent.nodeSize,
            [type.create(attrsFromSketchData(data)), paragraph.create()],
          )
          view.dispatch(tr.scrollIntoView())
          activateSketch(view, data.id)
          return true
        },
      },
    }),
)

export const sketchNodeViewPlugins = [
  sketchControlsCtx,
  sketchNodeView,
  sketchInteractivity,
  sketchInsertAffordance,
  sketchSlashCommand,
].flat()
