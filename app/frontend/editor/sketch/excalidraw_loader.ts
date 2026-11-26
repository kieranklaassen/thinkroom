// Excalidraw is loaded dynamically so it never enters the editor's static
// module graph. That keeps the editor bundle small AND keeps the server-side
// render graph free of Excalidraw, whose eager open-color.json import breaks
// Vite's SSR module loader.
export const loadExcalidraw = () => import('@excalidraw/excalidraw')
export const loadExcalidrawCanvas = () => import('./excalidraw_canvas')

let warming: Promise<unknown> | null = null

/** Fetch the exact preview renderer and the drawing canvas before they are
 * needed, so neither the lightweight preview nor "Loading canvas…" shows.
 * Failures stay silent: whoever needs the module loads it again and has its
 * own fallback. */
export const warmSketchTools = (): void => {
  warming ??= Promise.all([loadExcalidraw(), loadExcalidrawCanvas()]).catch(() => undefined)
}
