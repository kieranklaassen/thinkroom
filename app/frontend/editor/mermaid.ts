import DOMPurify from 'dompurify'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

type MermaidApi = (typeof import('mermaid'))['default']

const RENDER_DELAY_MS = 120
const mermaidDecorationsKey = new PluginKey<DecorationSet>('thinkroomMermaid')

let mermaidPromise: Promise<MermaidApi> | null = null
let renderSequence = 0

const loadMermaid = (): Promise<MermaidApi> => {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'neutral',
      // SVG <text> survives the strict SVG sanitizer; HTML labels rely on
      // foreignObject and would be removed along with that broader attack
      // surface, leaving correctly rendered shapes with invisible labels.
      htmlLabels: false,
      fontFamily: 'Assistant, ui-sans-serif, system-ui, sans-serif',
    })
    return mermaid
  })
  return mermaidPromise
}

const sourceHash = (source: string): string => {
  let hash = 2_166_136_261
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16_777_619)
  }
  return (hash >>> 0).toString(36)
}

const statusElement = (message: string): HTMLElement => {
  const status = document.createElement('span')
  status.className = 'mermaid-diagram-status'
  status.setAttribute('role', 'status')
  status.textContent = message
  return status
}

const sanitizedSvg = (source: string): SVGSVGElement | null => {
  const template = document.createElement('template')
  template.innerHTML = String(DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
  }))
  return template.content.querySelector('svg')
}

const renderDiagram = async (figure: HTMLElement, source: string): Promise<void> => {
  if (!source.trim()) throw new Error('Empty Mermaid source')

  const mermaid = await loadMermaid()
  const parsed = await mermaid.parse(source, { suppressErrors: true })
  if (!parsed) throw new Error('Invalid Mermaid source')

  const id = `thinkroom-mermaid-${++renderSequence}`
  const { svg } = await mermaid.render(id, source)
  const rendered = sanitizedSvg(svg)
  if (!rendered) throw new Error('Mermaid returned no SVG')
  if (!rendered.hasAttribute('aria-label') && !rendered.hasAttribute('aria-labelledby')) {
    rendered.setAttribute('aria-label', 'Mermaid diagram')
  }
  rendered.setAttribute('role', 'img')
  rendered.classList.add('mermaid-diagram-svg')

  if (!figure.isConnected) return
  figure.dataset.state = 'ready'
  figure.replaceChildren(rendered)
}

const diagramWidget = (position: number, source: string): Decoration => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  return Decoration.widget(
    position,
    () => {
      const figure = document.createElement('figure')
      figure.className = 'mermaid-diagram'
      figure.contentEditable = 'false'
      figure.dataset.state = 'loading'
      figure.setAttribute('aria-label', 'Mermaid diagram')
      figure.replaceChildren(statusElement('Rendering diagram…'))

      timer = setTimeout(() => {
        timer = null
        if (destroyed || !figure.isConnected) return
        void renderDiagram(figure, source).catch(() => {
          if (destroyed || !figure.isConnected) return
          figure.dataset.state = 'error'
          figure.replaceChildren(statusElement('Couldn’t render this Mermaid diagram.'))
        })
      }, RENDER_DELAY_MS)

      return figure
    },
    {
      side: -1,
      key: `mermaid-${position}-${sourceHash(source)}`,
      ignoreSelection: true,
      destroy: () => {
        destroyed = true
        if (timer) clearTimeout(timer)
      },
    },
  )
}

const decorationsFor = (doc: Node): DecorationSet => {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    const language = typeof node.attrs.language === 'string'
      ? node.attrs.language.trim().toLowerCase()
      : ''
    if (node.type.name === 'code_block' && language === 'mermaid') {
      decorations.push(diagramWidget(position, node.textContent))
    }
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Render fenced Mermaid code blocks without replacing their document nodes.
 * The native code block remains the collaborative, serializable source; this
 * plugin only adds a derived browser preview immediately before it.
 */
export const mermaidDiagrams = $prose(
  () => new Plugin<DecorationSet>({
    key: mermaidDecorationsKey,
    state: {
      init: (_, state) => decorationsFor(state.doc),
      apply: (transaction, decorations) => (
        transaction.docChanged
          ? decorationsFor(transaction.doc)
          : decorations.map(transaction.mapping, transaction.doc)
      ),
    },
    props: {
      decorations: (state) => mermaidDecorationsKey.getState(state) ?? null,
    },
  }),
)
