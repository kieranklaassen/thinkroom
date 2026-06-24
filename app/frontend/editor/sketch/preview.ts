import type { SketchScene } from './scene'

const SVG_NS = 'http://www.w3.org/2000/svg'

const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const string = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

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
  const live = scene.elements.filter((element) => element.isDeleted !== true)
  const bounds = live.reduce<{ minX: number; minY: number; maxX: number; maxY: number }>(
    (box, element) => {
      const x = number(element.x)
      const y = number(element.y)
      const width = Math.abs(number(element.width))
      const height = Math.abs(number(element.height))
      return {
        minX: Math.min(box.minX, x),
        minY: Math.min(box.minY, y),
        maxX: Math.max(box.maxX, x + width),
        maxY: Math.max(box.maxY, y + height),
      }
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
  const empty = !Number.isFinite(bounds.minX)
  const padding = 24
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
      fill: string(scene.appState.viewBackgroundColor, '#ffffff'),
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
