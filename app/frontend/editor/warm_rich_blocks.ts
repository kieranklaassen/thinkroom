import { warmHighlighter } from './highlighter'
import { warmSketchTools } from './sketch/excalidraw_loader'

/** Start loading what the document's own blocks need, as early as possible:
 * by the time the collab doc binds, sketches render their exact preview into
 * the first painted frame and code is already colored. The server preview is
 * the earliest place a block can be seen. Text documents need neither. */
export const warmForContent = (contentHtml: string): void => {
  if (/<pre[\s>]/.test(contentHtml)) warmHighlighter()
  if (contentHtml.includes('thinkroom-sketch')) warmSketchTools()
}

const IDLE_TIMEOUT_MS = 5000

/** Anyone who may edit can switch to Edit, or start a code block, after the
 * connection is gone. Once the page has loaded and is idle, fetch what that
 * needs; a viewer who cannot edit never does. Returns the cancel. */
export const warmForEditorsWhenIdle = (canWrite: boolean): (() => void) => {
  if (!canWrite) return () => undefined

  let idle: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const warm = () => {
    warmHighlighter()
    warmSketchTools()
  }
  const schedule = () => {
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(warm, { timeout: IDLE_TIMEOUT_MS })
    } else {
      timer = setTimeout(warm, 1000)
    }
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })

  return () => {
    window.removeEventListener('load', schedule)
    if (idle !== null) window.cancelIdleCallback(idle)
    if (timer !== null) clearTimeout(timer)
  }
}
