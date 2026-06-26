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
const BLOCK_SELECTOR = '.thinkroom-sketch, .milkdown-table-block'

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

const syncHandleValue = (handle: HTMLButtonElement) => {
  const block = handle.closest<HTMLElement>(BLOCK_SELECTOR)
  if (!block) return

  const width = Math.round(block.getBoundingClientRect().width)
  const { minimum, maximum } = widthBounds(block)
  handle.setAttribute('aria-valuemin', String(minimum))
  handle.setAttribute('aria-valuemax', String(maximum))
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
  handle.setAttribute('aria-label', 'Sketch and table width')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.title = 'Drag to resize sketches and tables · Arrow keys adjust · Double-click resets'
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
  syncHandleValue(handle)
}

const richBlockWidthControlsProse = $prose(
  () =>
    new Plugin({
      key: richBlockWidthKey,
      view: (view) => {
        let frame: number | null = null

        const sync = () => {
          frame = null
          view.dom.querySelectorAll<HTMLElement>(BLOCK_SELECTOR).forEach((block) => {
            if (!block.querySelector(':scope > .rich-block-width-handle')) buildHandle(block)
          })
          view.dom.querySelectorAll<HTMLButtonElement>('.rich-block-width-handle').forEach(syncHandleValue)
        }
        const scheduleSync = () => {
          if (frame !== null) return
          frame = requestAnimationFrame(sync)
        }

        sync()
        const mutationObserver = new MutationObserver(scheduleSync)
        mutationObserver.observe(view.dom, { childList: true, subtree: true })
        const resizeObserver = typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(scheduleSync)
        resizeObserver?.observe(view.dom)
        window.addEventListener('resize', scheduleSync)
        window.addEventListener(RICH_BLOCK_WIDTH_EVENT, scheduleSync)

        return {
          update: scheduleSync,
          destroy: () => {
            if (frame !== null) cancelAnimationFrame(frame)
            mutationObserver.disconnect()
            resizeObserver?.disconnect()
            window.removeEventListener('resize', scheduleSync)
            window.removeEventListener(RICH_BLOCK_WIDTH_EVENT, scheduleSync)
          },
        }
      },
    }),
)

export const richBlockWidthControls = [richBlockWidthControlsProse].flat()
