import type { SketchScene } from './scene'
import { downloadBlob } from '../../lib/download'
import { excalidrawAppState, excalidrawElements } from './excalidraw_adapter'

export async function sketchToSvg(scene: SketchScene): Promise<SVGSVGElement> {
  const { exportToSvg } = await import('@excalidraw/excalidraw')
  return exportToSvg({
    elements: excalidrawElements(scene.elements),
    appState: {
      ...excalidrawAppState(scene.appState),
      exportBackground: true,
      exportEmbedScene: false,
    },
    files: {},
    exportPadding: 24,
  })
}

export const svgMarkup = (svg: SVGSVGElement): string =>
  new XMLSerializer().serializeToString(svg)

export async function copySketchSvg(scene: SketchScene): Promise<void> {
  const markup = svgMarkup(await sketchToSvg(scene))
  const blob = new Blob([markup], { type: 'image/svg+xml' })
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': blob })])
  } catch {
    await navigator.clipboard.writeText(markup)
  }
}

export async function downloadSketchSvg(scene: SketchScene, name: string): Promise<void> {
  const markup = svgMarkup(await sketchToSvg(scene))
  const filename = `${name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'sketch'}.svg`
  downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), filename)
}
