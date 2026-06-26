import type { Node as MarkdownNode } from '@milkdown/kit/transformer'
import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import {
  SKETCH_FORMAT_VERSION,
  normalizeSketchData,
  parseSketchData,
  serializeSketchData,
  sketchAccessibleLabel,
  type SketchData,
} from './scene'

type MutableMarkdownNode = MarkdownNode & {
  type: string
  lang?: string | null
  value?: string
  children?: MutableMarkdownNode[]
}

const transformSketchFences = (node: MarkdownNode): void => {
  const mutable = node as MutableMarkdownNode
  if (
    mutable.type === 'code' &&
    mutable.lang?.toLowerCase() === 'excalidraw' &&
    parseSketchData(mutable.value ?? '')
  ) {
    mutable.type = 'thinkroomSketch'
  }
  mutable.children?.forEach(transformSketchFences)
}

const remarkSketchPlugin = $remark('remarkSketch', () => () => transformSketchFences)

export const attrsFromSketchData = (data: SketchData) => ({
  id: data.id,
  scene: JSON.stringify(data.scene),
  description: data.description,
  height: data.height,
  formatVersion: data.formatVersion,
})

export const dataFromSketchNode = (node: {
  attrs: Record<string, unknown>
}): SketchData | null =>
  normalizeSketchData({
    id: node.attrs.id,
    formatVersion: node.attrs.formatVersion,
    description: node.attrs.description,
    height: node.attrs.height,
    scene:
      typeof node.attrs.scene === 'string'
        ? (() => {
            try {
              return JSON.parse(node.attrs.scene)
            } catch {
              return null
            }
          })()
        : null,
  })

export const sketchSchema = $nodeSchema('thinkroomSketch', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  marks: '',
  attrs: {
    id: { default: '' },
    scene: { default: '' },
    description: { default: '' },
    height: { default: null },
    formatVersion: { default: SKETCH_FORMAT_VERSION },
  },
  parseDOM: [
    {
      tag: 'figure[data-thinkroom-sketch]',
      getAttrs: (dom) => {
        const element = dom as HTMLElement
        const data = normalizeSketchData({
          id: element.dataset.sketchId,
          formatVersion: Number(element.dataset.formatVersion),
          description: element.dataset.description ?? '',
          height: element.dataset.sketchHeight
            ? Number(element.dataset.sketchHeight)
            : undefined,
          scene: (() => {
            try {
              return JSON.parse(element.dataset.scene ?? '')
            } catch {
              return null
            }
          })(),
        })
        return data ? attrsFromSketchData(data) : false
      },
    },
  ],
  toDOM: (node) => {
    const data = dataFromSketchNode(node)
    if (!data) return ['p', 'Invalid sketch']
    return [
      'figure',
      {
        'data-thinkroom-sketch': '',
        'data-sketch-id': data.id,
        'data-format-version': String(data.formatVersion),
        'data-description': data.description,
        'data-sketch-height': String(data.height),
        'data-scene': JSON.stringify(data.scene),
        'aria-label': sketchAccessibleLabel(data),
      },
      ['figcaption', data.description || 'Sketch'],
    ]
  },
  parseMarkdown: {
    match: ({ type }) => type === 'thinkroomSketch',
    runner: (state, node, type) => {
      const data = parseSketchData((node.value as string | undefined) ?? '')
      if (data) state.addNode(type, attrsFromSketchData(data))
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'thinkroomSketch',
    runner: (state, node) => {
      const data = dataFromSketchNode(node)
      if (data) state.addNode('code', undefined, serializeSketchData(data), { lang: 'excalidraw' })
    },
  },
}))

export const sketchSchemaPlugins = [remarkSketchPlugin, sketchSchema].flat()
