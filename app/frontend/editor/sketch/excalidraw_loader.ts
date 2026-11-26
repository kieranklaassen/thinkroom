import { connectedImport, isOffline } from '../connection'

// Excalidraw is loaded dynamically so it never enters the editor's static
// module graph. That keeps the editor bundle small AND keeps the server-side
// render graph free of Excalidraw, whose eager open-color.json import breaks
// Vite's SSR module loader.
const excalidraw = connectedImport(() => import('@excalidraw/excalidraw'))
const canvas = connectedImport(() => import('./excalidraw_canvas'))

export const loadExcalidraw = excalidraw.whenOnline
export const loadExcalidrawCanvas = canvas.whenOnline
/** For a click that expects an answer: fails at once when offline. */
export const loadExcalidrawNow = excalidraw.now

let warmed = false

/** Fetch the exact preview renderer and the drawing canvas before they are
 * needed, so neither the lightweight preview nor "Loading canvas…" shows.
 * Skipped offline. Failures stay silent: whoever needs the module asks for it
 * again and has its own fallback. Only this head start happens once. */
export const warmSketchTools = (): void => {
  if (warmed || isOffline()) return
  warmed = true
  Promise.all([loadExcalidraw(), loadExcalidrawCanvas()]).catch(() => undefined)
}
