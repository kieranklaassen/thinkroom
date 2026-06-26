import { editorViewCtx, schemaCtx, type Editor } from '@milkdown/kit/core'
import { getMarkdown } from '@milkdown/kit/utils'
import { downloadBlob } from '../lib/download'
import { serializeHtml } from './document_format'
import { sketchToSvg } from './sketch/export'
import { normalizeSketchData } from './sketch/scene'

const EXPORTED_DOCUMENT_STYLES = `
  :root { color-scheme: light; font-family: Georgia, 'Times New Roman', serif; }
  body { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; color: #28231d; background: #fffef9; font-size: 17px; line-height: 1.7; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; letter-spacing: -0.015em; }
  h1 { font-size: 2rem; } h2 { margin-top: 1.6em; font-size: 1.45rem; } h3 { margin-top: 1.3em; font-size: 1.15rem; }
  a { color: #6f4f2d; text-underline-offset: 2px; }
  blockquote { margin-left: 0; border-left: 3px solid #d4c6b4; padding-left: 1.1em; color: #625b52; }
  pre { overflow-x: auto; border-radius: 8px; background: #f3eee5; padding: 1rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  img, svg { display: block; max-width: 100%; height: auto; }
  figure { margin: 1.5rem 0; overflow: hidden; border: 1px solid #ded4c6; border-radius: 12px; background: #fffef9; }
  figure svg { width: 100%; }
  figcaption { border-top: 1px solid #e7ded2; padding: 0.55rem 0.75rem; color: #71685d; font: 500 12px/1.35 system-ui, sans-serif; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ded4c6; padding: 0.45rem 0.6rem; text-align: left; }
  ins { text-decoration: none; background: #e7f2df; } del { background: #f7e3df; }
  @media print { body { max-width: none; padding: 0; } }
`

const safeFilename = (title: string, extension: string): string => {
  const base = title
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return `${base || 'thinkroom-document'}.${extension}`
}

export function downloadDocumentMarkdown(editor: Editor, title: string): void {
  const markdown = editor.action((ctx) => getMarkdown()(ctx))
  downloadBlob(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    safeFilename(title, 'md'),
  )
}

const sketchDataFromFigure = (figure: HTMLElement) => {
  try {
    return normalizeSketchData({
      id: figure.dataset.sketchId,
      formatVersion: Number(figure.dataset.formatVersion),
      description: figure.dataset.description ?? '',
      height: figure.dataset.sketchHeight ? Number(figure.dataset.sketchHeight) : undefined,
      scene: JSON.parse(figure.dataset.scene ?? ''),
    })
  } catch {
    return null
  }
}

const absolutizeDocumentUrls = (root: ParentNode): void => {
  root.querySelectorAll<HTMLElement>('[href], [src]').forEach((element) => {
    for (const attribute of ['href', 'src']) {
      const value = element.getAttribute(attribute)
      if (!value || value.startsWith('#') || value.startsWith('data:')) continue
      try {
        element.setAttribute(attribute, new URL(value, window.location.origin).href)
      } catch {
        // The editor sanitizer has already constrained URLs. Leave an unusual
        // but valid value untouched if the URL constructor cannot normalize it.
      }
    }
  })
}

export async function exportedDocumentHtml(editor: Editor, title: string): Promise<string> {
  const source = editor.action((ctx) =>
    serializeHtml(ctx.get(editorViewCtx).state.doc, ctx.get(schemaCtx)),
  )
  const exported = document.implementation.createHTMLDocument(title.trim() || 'Thinkroom document')
  exported.documentElement.lang = 'en'
  const charset = exported.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const viewport = exported.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  const style = exported.createElement('style')
  style.textContent = EXPORTED_DOCUMENT_STYLES
  exported.head.prepend(charset, viewport)
  exported.head.append(style)

  const main = exported.createElement('main')
  main.innerHTML = source
  const sketches = Array.from(
    main.querySelectorAll<HTMLElement>('figure[data-thinkroom-sketch]'),
  )
  await Promise.all(
    sketches.map(async (figure) => {
      const data = sketchDataFromFigure(figure)
      if (!data) return
      const svg = await sketchToSvg(data.scene)
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', data.description || 'Sketch')
      const caption = exported.createElement('figcaption')
      caption.textContent = data.description || 'Sketch'
      figure.replaceChildren(exported.importNode(svg, true), caption)
      for (const attribute of Array.from(figure.attributes)) {
        if (attribute.name.startsWith('data-') || attribute.name === 'aria-label') {
          figure.removeAttribute(attribute.name)
        }
      }
    }),
  )
  absolutizeDocumentUrls(main)
  exported.body.replaceChildren(main)
  return `<!doctype html>\n${exported.documentElement.outerHTML}`
}

export async function downloadDocumentHtml(editor: Editor, title: string): Promise<void> {
  const html = await exportedDocumentHtml(editor, title)
  downloadBlob(
    new Blob([html], { type: 'text/html;charset=utf-8' }),
    safeFilename(title, 'html'),
  )
}

export function printDocument(): void {
  window.print()
}
