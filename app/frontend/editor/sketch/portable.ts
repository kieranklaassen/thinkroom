import { DOMSerializer, Fragment, type Node, type Schema } from '@milkdown/kit/prose/model'
import { renderSketchPreview } from './preview'
import { dataFromSketchNode } from './schema'
import type { SketchData } from './scene'

type MarkdownSerializer = (document: Node) => string
type SketchRenderer = (data: SketchData) => SVGSVGElement
type AsyncSketchRenderer = (data: SketchData) => Promise<SVGSVGElement>

interface PortableSketch {
  data: SketchData
  token: string
}

const placeholderPrefix = (document: Node): string => {
  let attempt = 0
  let prefix = ''
  do {
    const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${attempt}`
    prefix = `THINKROOM-SKETCH-${random.toUpperCase()}-`
    attempt += 1
  } while (document.textContent.includes(prefix))
  return prefix
}

const preparePortableDocument = (
  document: Node,
  schema: Schema,
): { document: Node; sketches: PortableSketch[] } => {
  const sketches: PortableSketch[] = []
  const prefix = placeholderPrefix(document)
  const paragraph = schema.nodes.paragraph
  if (!paragraph) throw new Error('Portable sketch export requires a paragraph node')

  const replaceSketches = (node: Node): Node => {
    if (node.type.name === 'thinkroomSketch') {
      const data = dataFromSketchNode(node)
      if (!data) return node
      const token = `${prefix}${sketches.length}`
      sketches.push({ data, token })
      return paragraph.create(null, schema.text(token))
    }
    if (node.isLeaf) return node

    const children: Node[] = []
    node.forEach((child) => children.push(replaceSketches(child)))
    return node.copy(Fragment.fromArray(children))
  }

  return { document: replaceSketches(document), sketches }
}

/** A semantic, metadata-free figure suitable for downloads and clipboard HTML. */
export const portableSketchFigure = (
  data: SketchData,
  sourceSvg: SVGSVGElement,
): HTMLElement => {
  const figure = globalThis.document.createElement('figure')
  const svg = sourceSvg.cloneNode(true) as SVGSVGElement
  const label = data.description || 'Sketch'
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', label)

  const caption = globalThis.document.createElement('figcaption')
  caption.textContent = label
  figure.append(svg, caption)
  return figure
}

const oneLineMarkup = (figure: HTMLElement): string =>
  figure.outerHTML.replace(/[\r\n]+/g, ' ')

const injectSketches = (
  markdown: string,
  sketches: PortableSketch[],
  figures: HTMLElement[],
): string => sketches.reduce(
  (output, sketch, index) => output.replace(sketch.token, oneLineMarkup(figures[index])),
  markdown,
)

export async function serializePortableMarkdown(
  document: Node,
  schema: Schema,
  serializer: MarkdownSerializer,
  render: AsyncSketchRenderer,
): Promise<string> {
  const prepared = preparePortableDocument(document, schema)
  const markdown = serializer(prepared.document)
  const figures = await Promise.all(
    prepared.sketches.map(async ({ data }) => portableSketchFigure(data, await render(data))),
  )
  return injectSketches(markdown, prepared.sketches, figures)
}

export function serializePortableMarkdownSync(
  document: Node,
  schema: Schema,
  serializer: MarkdownSerializer,
  render: SketchRenderer = (data) => renderSketchPreview(data.scene),
): string {
  const prepared = preparePortableDocument(document, schema)
  const markdown = serializer(prepared.document)
  const figures = prepared.sketches.map(({ data }) => portableSketchFigure(data, render(data)))
  return injectSketches(markdown, prepared.sketches, figures)
}

/** Preserve the active clipboard serializer for every ordinary node/mark and
 * replace only Thinkroom's private sketch node with portable SVG markup. */
export function portableClipboardSerializer(
  schema: Schema,
  base: DOMSerializer = DOMSerializer.fromSchema(schema),
): DOMSerializer {
  return new DOMSerializer(
    {
      ...base.nodes,
      thinkroomSketch: (node) => {
        const data = dataFromSketchNode(node)
        if (!data) return base.nodes.thinkroomSketch?.(node) ?? ['p', 'Invalid sketch']
        return portableSketchFigure(data, renderSketchPreview(data.scene))
      },
    },
    base.marks,
  )
}

export function containsSketch(document: Node): boolean {
  if (document.type.name === 'thinkroomSketch') return true
  let found = false
  document.descendants((node) => {
    if (node.type.name !== 'thinkroomSketch') return !found
    found = true
    return false
  })
  return found
}
