import {
  MAX_SKETCH_HEIGHT,
  MIN_SKETCH_HEIGHT,
  type SketchScene,
} from './scene'

// Excalidraw is loaded dynamically (like sketch/export.ts) so it never enters
// the editor's static module graph. That keeps the editor bundle small AND
// keeps the server-side render graph free of Excalidraw, whose eager
// open-color.json import breaks Vite's SSR module loader. Only the exact
// preview path below touches it, and it is already async + fire-and-forget.
const loadExcalidraw = () => import('@excalidraw/excalidraw')

const SVG_NS = 'http://www.w3.org/2000/svg'
const SKETCH_PADDING = 24

const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const string = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

const contentBounds = (scene: SketchScene) => {
  const live = scene.elements.filter((element) => element.isDeleted !== true)
  const bounds = live.reduce<{ minX: number; minY: number; maxX: number; maxY: number }>(
    (box, element) => {
      const x = number(element.x)
      const y = number(element.y)
      const width = Math.abs(number(element.width))
      const height = Math.abs(number(element.height))
      const angle = number(element.angle)
      const rotatedWidth = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))
      const rotatedHeight = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))
      const centerX = x + number(element.width) / 2
      const centerY = y + number(element.height) / 2
      return {
        minX: Math.min(box.minX, centerX - rotatedWidth / 2),
        minY: Math.min(box.minY, centerY - rotatedHeight / 2),
        maxX: Math.max(box.maxX, centerX + rotatedWidth / 2),
        maxY: Math.max(box.maxY, centerY + rotatedHeight / 2),
      }
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
  return { live, bounds, empty: !Number.isFinite(bounds.minX) }
}

const svgElement = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
  return element
}

/** Lightweight document preview. The full Excalidraw renderer stays lazy and
 * is used for editing/export; this renderer keeps initial document load small. */
export function renderSketchPreview(scene: SketchScene): SVGSVGElement {
  const { live, bounds, empty } = contentBounds(scene)
  const padding = SKETCH_PADDING
  const minX = empty ? 0 : bounds.minX - padding
  const minY = empty ? 0 : bounds.minY - padding
  const width = empty ? 640 : Math.max(240, bounds.maxX - bounds.minX + padding * 2)
  const height = empty ? 320 : Math.max(140, bounds.maxY - bounds.minY + padding * 2)
  const svg = svgElement('svg', {
    viewBox: `${minX} ${minY} ${width} ${height}`,
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  })
  svg.classList.add('sketch-preview-svg')
  svg.appendChild(
    svgElement('rect', {
      x: minX,
      y: minY,
      width,
      height,
      fill: 'transparent',
    }),
  )

  for (const element of live) {
    const x = number(element.x)
    const y = number(element.y)
    const w = number(element.width)
    const h = number(element.height)
    const stroke = string(element.strokeColor, '#1b1b1f')
    const fill = string(element.backgroundColor, 'transparent')
    const strokeWidth = number(element.strokeWidth, 2)
    const opacity = number(element.opacity, 100) / 100
    const group = svgElement('g', {
      opacity,
      transform: `rotate(${(number(element.angle) * 180) / Math.PI} ${x + w / 2} ${y + h / 2})`,
    })
    const common = { stroke, 'stroke-width': strokeWidth, fill, 'stroke-linecap': 'round' }

    if (element.type === 'rectangle' || element.type === 'frame') {
      group.appendChild(svgElement('rect', { x, y, width: w, height: h, rx: 4, ...common }))
    } else if (element.type === 'ellipse') {
      group.appendChild(
        svgElement('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: Math.abs(w / 2), ry: Math.abs(h / 2), ...common }),
      )
    } else if (element.type === 'diamond') {
      group.appendChild(
        svgElement('polygon', {
          points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`,
          ...common,
        }),
      )
    } else if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
      const rawPoints = Array.isArray(element.points) ? element.points : []
      const points = rawPoints
        .filter((point): point is unknown[] => Array.isArray(point) && point.length >= 2)
        .map((point) => `${x + number(point[0])},${y + number(point[1])}`)
        .join(' ')
      group.appendChild(svgElement('polyline', { points, ...common, fill: 'none' }))
      if (element.type === 'arrow' && rawPoints.length >= 2) {
        const end = rawPoints[rawPoints.length - 1] as unknown[]
        const before = rawPoints[rawPoints.length - 2] as unknown[]
        const ex = x + number(end[0])
        const ey = y + number(end[1])
        const angle = Math.atan2(ey - (y + number(before[1])), ex - (x + number(before[0])))
        const size = Math.max(8, strokeWidth * 4)
        group.appendChild(
          svgElement('polyline', {
            points: `${ex - Math.cos(angle - 0.55) * size},${ey - Math.sin(angle - 0.55) * size} ${ex},${ey} ${ex - Math.cos(angle + 0.55) * size},${ey - Math.sin(angle + 0.55) * size}`,
            stroke,
            'stroke-width': strokeWidth,
            fill: 'none',
            'stroke-linecap': 'round',
          }),
        )
      }
    } else if (element.type === 'text') {
      const fontSize = number(element.fontSize, 20)
      const text = svgElement('text', {
        x,
        y: y + fontSize,
        fill: stroke,
        stroke: 'none',
        'font-size': fontSize,
        'font-family': 'system-ui, sans-serif',
      })
      string(element.text, '').split('\n').forEach((line, index) => {
        const tspan = svgElement('tspan', { x, dy: index === 0 ? 0 : fontSize * 1.25 })
        tspan.textContent = line
        text.appendChild(tspan)
      })
      group.appendChild(text)
    }
    svg.appendChild(group)
  }

  if (empty) {
    const label = svgElement('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: '#8b867f',
      'font-size': 18,
      'font-family': 'system-ui, sans-serif',
    })
    label.textContent = 'Empty sketch'
    svg.appendChild(label)
  }
  return svg
}

/** Render the document preview with Excalidraw's own RoughJS/freehand
 * pipeline. The lightweight renderer above is only a failure fallback; the
 * exact renderer replaces it in the pre-paint microtask. */
export interface SketchViewport {
  height: number
  scrollX: number
  scrollY: number
  zoom: number
}

export function fitSketchViewport(
  scene: SketchScene,
  viewportWidth: number,
  minimumHeight: number,
): SketchViewport {
  const { bounds, empty } = contentBounds(scene)
  if (empty) return { height: minimumHeight, scrollX: 0, scrollY: 0, zoom: 1 }

  const padding = SKETCH_PADDING
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX)
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY)
  const paddedWidth = contentWidth + padding * 2
  const paddedHeight = contentHeight + padding * 2
  const zoom = Math.max(
    0.1,
    Math.min(viewportWidth / paddedWidth, MAX_SKETCH_HEIGHT / paddedHeight),
  )
  const height = Math.min(
    MAX_SKETCH_HEIGHT,
    Math.max(MIN_SKETCH_HEIGHT, minimumHeight, Math.ceil(paddedHeight * zoom)),
  )
  return {
    height,
    scrollX: (viewportWidth / zoom - contentWidth) / 2 - bounds.minX,
    scrollY: (height / zoom - contentHeight) / 2 - bounds.minY,
    zoom,
  }
}

/** Preserve the viewport Excalidraw emitted while the user was editing.
 * Re-fitting after save would make the closed preview visibly zoom. */
export function sketchSceneViewport(scene: SketchScene, height: number): SketchViewport {
  const zoom = scene.appState.zoom
  const zoomValue = zoom && typeof zoom === 'object' && 'value' in zoom
    ? number(zoom.value, 1)
    : 1
  return {
    height,
    scrollX: number(scene.appState.scrollX),
    scrollY: number(scene.appState.scrollY),
    zoom: zoomValue,
  }
}

/** Reuse a persisted editor viewport when it still shows the complete scene.
 * Agent-authored or legacy scenes with missing/clipped viewport state fall
 * back to fitSketchViewport instead. */
export function storedSketchViewport(
  scene: SketchScene,
  width: number,
  height: number,
): SketchViewport | null {
  if (
    typeof scene.appState.scrollX !== 'number' ||
    typeof scene.appState.scrollY !== 'number' ||
    !scene.appState.zoom ||
    typeof scene.appState.zoom !== 'object' ||
    !('value' in scene.appState.zoom) ||
    typeof scene.appState.zoom.value !== 'number'
  ) return null

  const viewport = sketchSceneViewport(scene, height)
  const { bounds, empty } = contentBounds(scene)
  if (empty) return viewport
  const left = (bounds.minX + viewport.scrollX) * viewport.zoom
  const top = (bounds.minY + viewport.scrollY) * viewport.zoom
  const right = (bounds.maxX + viewport.scrollX) * viewport.zoom
  const bottom = (bounds.maxY + viewport.scrollY) * viewport.zoom
  const guard = SKETCH_PADDING * viewport.zoom
  return left >= guard && top >= guard && right <= width - guard && bottom <= height - guard
    ? viewport
    : null
}

export async function renderExactSketchPreview(
  scene: SketchScene,
  viewportWidth: number,
  fittedViewport: SketchViewport,
): Promise<SVGSVGElement | null> {
  const elements = scene.elements.filter((element) => element.isDeleted !== true)
  if (elements.length === 0) return null

  const { exportToSvg, getCommonBounds, sceneCoordsToViewportCoords } = await loadExcalidraw()

  const exportPadding = SKETCH_PADDING
  const exported = await exportToSvg({
    elements: elements as never,
    appState: {
      ...scene.appState,
      exportBackground: false,
      exportWithDarkMode: false,
      viewBackgroundColor: '#fffef9',
    } as never,
    files: null,
    exportPadding,
    skipInliningFonts: true,
  })
  const [minX, minY] = getCommonBounds(elements as never)
  const viewportHeight = fittedViewport.height
  const scrollX = fittedViewport.scrollX
  const scrollY = fittedViewport.scrollY
  const zoomValue = fittedViewport.zoom
  const topLeft = sceneCoordsToViewportCoords(
    { sceneX: minX - exportPadding, sceneY: minY - exportPadding },
    {
      zoom: { value: zoomValue } as never,
      offsetLeft: 0,
      offsetTop: 0,
      scrollX,
      scrollY,
    },
  )
  const svg = svgElement('svg', {
    viewBox: `0 0 ${viewportWidth} ${viewportHeight}`,
    width: viewportWidth,
    height: viewportHeight,
    preserveAspectRatio: 'none',
  })
  // Excalidraw may device-scale the SVG's width/height attributes (2× on a
  // Retina display). The viewBox remains in stable scene/CSS coordinates,
  // which is what the editor canvas and our outer viewport both use.
  const exportedViewBox = exported.getAttribute('viewBox')
    ?.trim()
    .split(/[ ,]+/)
    .map(Number)
  const exportedWidth = number(exportedViewBox?.[2], Number(exported.getAttribute('width')))
  const exportedHeight = number(exportedViewBox?.[3], Number(exported.getAttribute('height')))
  exported.setAttribute('x', String(topLeft.x))
  exported.setAttribute('y', String(topLeft.y))
  exported.setAttribute('width', String(exportedWidth * zoomValue))
  exported.setAttribute('height', String(exportedHeight * zoomValue))
  exported.dataset.excalidrawScene = ''
  svg.append(exported)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('role', 'img')
  svg.setAttribute('focusable', 'false')
  svg.dataset.renderer = 'excalidraw'
  svg.classList.add('sketch-preview-svg')
  return svg
}
