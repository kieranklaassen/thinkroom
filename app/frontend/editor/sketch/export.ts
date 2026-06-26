import type { SketchScene } from './scene'
import { downloadBlob } from '../../lib/download'

export async function sketchToSvg(scene: SketchScene): Promise<SVGSVGElement> {
  const { exportToSvg } = await import('@excalidraw/excalidraw')
  return exportToSvg({
    elements: scene.elements as never,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportEmbedScene: false,
    } as never,
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
