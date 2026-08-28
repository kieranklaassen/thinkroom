import type {
  ExcalidrawElement,
  NonDeleted,
} from '@excalidraw/excalidraw/element/types'
import type { AppState, NormalizedZoomValue } from '@excalidraw/excalidraw/types'
import type { SketchScene } from './scene'

/**
 * The one place where sanitized sketch JSON is asserted into Excalidraw's
 * types. SketchScene deliberately stores elements/appState as plain JSON
 * records (normalizeSketchScene guarantees the shape: known element types,
 * safe colors, no files/links), while Excalidraw's element types are far
 * stricter than what it accepts at runtime — its own import path restores
 * loose scene JSON. Rather than scatter `as never` lies at every call site,
 * callers convert through these documented assertions.
 *
 * Type-only imports keep Excalidraw out of the static module graph: the
 * renderer itself stays a dynamic import (see preview.ts).
 */

export const excalidrawElements = (
  elements: SketchScene['elements'],
): readonly NonDeleted<ExcalidrawElement>[] =>
  elements as unknown as readonly NonDeleted<ExcalidrawElement>[]

export const excalidrawAppState = (
  appState: SketchScene['appState'],
): Partial<AppState> => appState as Partial<AppState>

export const excalidrawZoom = (value: number): AppState['zoom'] => ({
  value: value as NormalizedZoomValue,
})
