export const SKETCH_FORMAT_VERSION = 1
export const MAX_SKETCH_BYTES = 512 * 1024
export const MAX_SKETCH_DESCRIPTION = 500
export const MAX_SKETCH_ELEMENTS = 500
export const MAX_SKETCH_POINTS = 20_000
export const DEFAULT_SKETCH_HEIGHT = 448
export const MIN_SKETCH_HEIGHT = 180
export const MAX_SKETCH_HEIGHT = 1200

const ELEMENT_TYPES = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'line',
  'arrow',
  'freedraw',
  'text',
  'frame',
])
const SAFE_COLOR = /^(?:transparent|#[0-9a-f]{3,8})$/i

type JsonRecord = Record<string, unknown>

export interface SketchScene {
  type: 'excalidraw'
  version: number
  elements: JsonRecord[]
  appState: JsonRecord
  files: Record<string, never>
}

export interface SketchData {
  id: string
  formatVersion: typeof SKETCH_FORMAT_VERSION
  description: string
  height: number
  scene: SketchScene
}

export const EMPTY_SKETCH_SCENE: SketchScene = {
  type: 'excalidraw',
  version: 2,
  elements: [],
  appState: { viewBackgroundColor: '#fffef9' },
  files: {},
}

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const byteLength = (value: string): number => new TextEncoder().encode(value).length
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isPoint = (value: unknown): value is [number, number, ...unknown[]] =>
  Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1])

/**
 * Normalize the editable source before it enters ProseMirror/Yjs. Excalidraw
 * SVG is derived from this data; imported files and links are deliberately
 * excluded so a sketch cannot become a remote-resource or document-size path.
 */
export function normalizeSketchScene(input: unknown): SketchScene | null {
  if (!isRecord(input) || input.type !== 'excalidraw') return null
  if (!Array.isArray(input.elements) || input.elements.length > MAX_SKETCH_ELEMENTS) return null
  if (input.appState !== undefined && !isRecord(input.appState)) return null
  if (input.files !== undefined && (!isRecord(input.files) || Object.keys(input.files).length > 0)) {
    return null
  }
  const inputAppState = (input.appState as JsonRecord | undefined) ?? {}
  if (
    inputAppState.viewBackgroundColor !== undefined &&
    (typeof inputAppState.viewBackgroundColor !== 'string' ||
      !SAFE_COLOR.test(inputAppState.viewBackgroundColor))
  ) {
    return null
  }

  let pointCount = 0
  const elements: JsonRecord[] = []
  for (const rawElement of input.elements) {
    if (!isRecord(rawElement) || typeof rawElement.type !== 'string') return null
    if (!ELEMENT_TYPES.has(rawElement.type) || rawElement.fileId || rawElement.link) return null
    for (const color of [rawElement.strokeColor, rawElement.backgroundColor]) {
      if (color !== undefined && (typeof color !== 'string' || !SAFE_COLOR.test(color))) return null
    }
    if (rawElement.points !== undefined) {
      if (!Array.isArray(rawElement.points) || !rawElement.points.every(isPoint)) return null
      pointCount += rawElement.points.length
      if (pointCount > MAX_SKETCH_POINTS) return null
    }

    const element = structuredClone(rawElement)
    delete element.link
    delete element.customData
    delete element.fileId
    elements.push(element)
  }

  const sourceAppState = inputAppState
  const appState: JsonRecord = {}
  const retainedAppState: Record<string, (value: unknown) => boolean> = {
    viewBackgroundColor: (value) => typeof value === 'string' && SAFE_COLOR.test(value),
    theme: (value) => value === 'light' || value === 'dark',
    gridSize: (value) => value === null || isFiniteNumber(value),
    gridStep: isFiniteNumber,
    gridModeEnabled: (value) => typeof value === 'boolean',
    objectsSnapModeEnabled: (value) => typeof value === 'boolean',
    zenModeEnabled: (value) => typeof value === 'boolean',
    scrollX: isFiniteNumber,
    scrollY: isFiniteNumber,
    zoom: (value) =>
      isRecord(value) &&
      isFiniteNumber(value.value) &&
      value.value >= 0.1 &&
      value.value <= 30,
  }
  for (const [key, valid] of Object.entries(retainedAppState)) {
    const value = sourceAppState[key]
    if (value === undefined) continue
    if (!valid(value)) return null
    appState[key] = structuredClone(value)
  }

  const scene: SketchScene = {
    type: 'excalidraw',
    version: typeof input.version === 'number' && input.version > 0 ? input.version : 2,
    elements,
    appState,
    files: {},
  }
  return byteLength(JSON.stringify(scene)) <= MAX_SKETCH_BYTES ? scene : null
}

export function normalizeSketchData(input: unknown): SketchData | null {
  if (!isRecord(input) || input.formatVersion !== SKETCH_FORMAT_VERSION) return null
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)) return null
  const scene = normalizeSketchScene(input.scene)
  if (!scene) return null
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (Array.from(description).length > MAX_SKETCH_DESCRIPTION) return null
  const height = input.height === undefined || input.height === null
    ? DEFAULT_SKETCH_HEIGHT
    : input.height
  if (
    !isFiniteNumber(height) ||
    height < MIN_SKETCH_HEIGHT ||
    height > MAX_SKETCH_HEIGHT
  ) return null
  return {
    id: input.id,
    formatVersion: SKETCH_FORMAT_VERSION,
    description,
    height: Math.round(height),
    scene,
  }
}

export function parseSketchData(source: string): SketchData | null {
  if (byteLength(source) > MAX_SKETCH_BYTES + 4096) return null
  try {
    return normalizeSketchData(JSON.parse(source))
  } catch {
    return null
  }
}

export function serializeSketchData(data: SketchData): string {
  return JSON.stringify(data)
}

export function sketchLabels(scene: SketchScene): string[] {
  return Array.from(
    new Set(
      scene.elements
        .filter((element) => element.type === 'text')
        .map((element) => (typeof element.text === 'string' ? element.text.trim() : ''))
        .filter(Boolean),
    ),
  ).slice(0, 50)
}

export function sketchAccessibleLabel(data: SketchData): string {
  const labels = sketchLabels(data.scene)
  return [data.description || 'Sketch', labels.length > 0 ? labels.join(', ') : '']
    .filter(Boolean)
    .join(': ')
}
