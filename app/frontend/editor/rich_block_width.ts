import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

export const DEFAULT_RICH_CONTENT_WIDTH = 960
export const MIN_RICH_CONTENT_WIDTH = 640
export const MAX_RICH_CONTENT_WIDTH = 1200
export const RICH_BLOCK_WIDTH_EVENT = 'thinkroom:rich-block-width'

export interface RichBlockWidthEventDetail {
  width: number | null
  commit: boolean
}

interface DragState {
  pointerId: number
  startX: number
  startWidth: number
  maxWidth: number
  reviewAligned: boolean
}

const richBlockWidthKey = new PluginKey('RICH_BLOCK_WIDTH')
// Sketches, tables, and fenced code blocks share one breakout width. The
// Mermaid source block is excluded: it pairs with a rendered diagram preview,
// so handling it here would stack a redundant second handle on the diagram.
const BLOCK_SELECTOR = '.thinkroom-sketch, .milkdown-table-block, pre:not([data-language="mermaid"])'
// Only top-level blocks break out; a `:scope`-rooted query keeps handles off
// code blocks nested inside list items or blockquotes, which never get the
// matching breakout width in CSS.
const BLOCK_QUERY = ':scope > .thinkroom-sketch, :scope > .milkdown-table-block, :scope > pre:not([data-language="mermaid"])'

const dispatchWidth = (width: number | null, commit: boolean) => {
  window.dispatchEvent(new CustomEvent<RichBlockWidthEventDetail>(RICH_BLOCK_WIDTH_EVENT, {
    detail: { width, commit },
  }))
}

const isReviewAligned = (block: HTMLElement) => {
  const page = block.closest('.doc-page')
  const canvas = block.closest('.doc-canvas')
  return !page?.classList.contains('is-read-mode') && !canvas?.classList.contains('is-focus')
}

const widthBounds = (block: HTMLElement) => {
  const prose = block.closest('.ProseMirror')
  const proseRect = prose?.getBoundingClientRect()
  const minimum = Math.max(MIN_RICH_CONTENT_WIDTH, Math.round(proseRect?.width ?? 0))
  const proseCenter = proseRect ? proseRect.left + proseRect.width / 2 : window.innerWidth / 2
  const available = isReviewAligned(block)
    ? Math.round((proseRect?.right ?? window.innerWidth) - 24)
    : Math.round(2 * Math.min(proseCenter - 24, window.innerWidth - 24 - proseCenter))

  return {
    minimum,
    maximum: Math.max(minimum, Math.min(MAX_RICH_CONTENT_WIDTH, available)),
  }
}

const clampWidth = (block: HTMLElement, width: number, maximum?: number) => {
  const bounds = widthBounds(block)
  return Math.round(Math.min(Math.max(width, bounds.minimum), maximum ?? bounds.maximum))
}

const syncHandleValue = (
  handle: HTMLButtonElement,
  block: HTMLElement,
  bounds: { minimum: number; maximum: number },
) => {
  const width = Math.round(block.getBoundingClientRect().width)
  handle.setAttribute('aria-valuemin', String(bounds.minimum))
  handle.setAttribute('aria-valuemax', String(bounds.maximum))
  handle.setAttribute('aria-valuenow', String(width))
  handle.setAttribute('aria-valuetext', `${width} pixels. Press Home or double-click to reset.`)
}

const buildHandle = (block: HTMLElement) => {
  const handle = document.createElement('button')
  const grip = document.createElement('span')
  let drag: DragState | null = null
  let lastWidth: number | null = null

  handle.type = 'button'
  handle.className = 'rich-block-width-handle'
  handle.contentEditable = 'false'
  handle.setAttribute('role', 'separator')
  handle.setAttribute('aria-label', 'Sketch, table, and code block width')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.title = 'Drag to resize sketches, tables, and code blocks · Arrow keys adjust · Double-click resets'
  grip.setAttribute('aria-hidden', 'true')
  grip.textContent = '•••'
  handle.append(grip)

  const stop = (event: Event) => event.stopPropagation()
  handle.addEventListener('mousedown', stop)
  handle.addEventListener('click', stop)

  handle.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
    dispatchWidth(null, true)
  })

  handle.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Home') {
      event.preventDefault()
      dispatchWidth(null, true)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

    event.preventDefault()
    const reviewAligned = isReviewAligned(block)
    const spatialDirection = event.key === 'ArrowRight' ? 1 : -1
    const widthDirection = reviewAligned ? -spatialDirection : spatialDirection
    const step = event.shiftKey ? 96 : 32
    const nextWidth = clampWidth(block, block.getBoundingClientRect().width + widthDirection * step)
    dispatchWidth(nextWidth, true)
  })

  const finishDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    drag = null
    handle.classList.remove('is-dragging')
    if (lastWidth !== null) dispatchWidth(lastWidth, true)
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    handle.setPointerCapture(event.pointerId)
    const bounds = widthBounds(block)
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: block.getBoundingClientRect().width,
      maxWidth: bounds.maximum,
      reviewAligned: isReviewAligned(block),
    }
    lastWidth = Math.round(drag.startWidth)
    handle.classList.add('is-dragging')
  })

  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientX - drag.startX
    const scale = drag.reviewAligned ? -1 : 2
    lastWidth = clampWidth(block, drag.startWidth + delta * scale, drag.maxWidth)
    dispatchWidth(lastWidth, false)
  })
  handle.addEventListener('pointerup', finishDrag)
  handle.addEventListener('pointercancel', finishDrag)

  block.append(handle)
  return handle
}

const richBlockWidthControlsProse = $prose(
  () =>
    new Plugin({
      key: richBlockWidthKey,
      view: (view) => {
        let frame: number | null = null
        const handles = new Map<HTMLElement, HTMLButtonElement>()

        // The aria values need block geometry. Reading it after every content
        // change forced a layout per code block, the editor's largest boot
        // cost on long documents. A ResizeObserver delivers block sizes after
        // layout has already run, so measuring inside its callback reads
        // clean geometry and forces nothing; it also fires for every cause
        // of a width change (window, shared width, page mode, new block).
        const measureBlocks = (blocks: HTMLElement[]) => {
          const [first] = blocks
          if (!first) return
          // Bounds derive from the editor root and page mode, so they are
          // the same for every block in one pass.
          const bounds = widthBounds(first)
          blocks.forEach((block) => {
            const handle = handles.get(block)
            if (handle) syncHandleValue(handle, block, bounds)
          })
        }
        const sizeObserver = typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver((entries) => {
              measureBlocks(entries.map((entry) => entry.target as HTMLElement))
            })

        // Content changes only reconcile which blocks carry a handle — DOM
        // writes, no reads.
        const reconcile = () => {
          frame = null
          view.dom.querySelectorAll<HTMLElement>(BLOCK_QUERY).forEach((block) => {
            if (handles.has(block)) return
            handles.set(block, buildHandle(block))
            sizeObserver?.observe(block)
          })
          handles.forEach((handle, block) => {
            // A block can leave the breakout set in place (e.g. a code block
            // whose language becomes mermaid) or leave the document: drop its
            // now-orphaned handle.
            if (block.isConnected && handle.closest(BLOCK_SELECTOR) === block) return
            sizeObserver?.unobserve(block)
            handle.remove()
            handles.delete(block)
          })
          if (!sizeObserver) measureBlocks(Array.from(handles.keys()))
        }
        const scheduleReconcile = () => {
          if (frame !== null) return
          frame = requestAnimationFrame(reconcile)
        }
        // A window resize can move the bounds without changing a block's
        // width (a block already at its minimum), which the size observer
        // never sees.
        const measureAll = () => measureBlocks(Array.from(handles.keys()))

        reconcile()
        const mutationObserver = new MutationObserver(scheduleReconcile)
        mutationObserver.observe(view.dom, { childList: true, subtree: true })
        window.addEventListener('resize', measureAll)

        return {
          update: scheduleReconcile,
          destroy: () => {
            if (frame !== null) cancelAnimationFrame(frame)
            mutationObserver.disconnect()
            sizeObserver?.disconnect()
            window.removeEventListener('resize', measureAll)
          },
        }
      },
    }),
)

export const richBlockWidthControls = [richBlockWidthControlsProse].flat()
