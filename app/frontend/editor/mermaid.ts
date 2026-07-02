import DOMPurify from 'dompurify'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $ctx, $prose } from '@milkdown/kit/utils'

type MermaidApi = (typeof import('mermaid'))['default']

/** Persisted per-document diagram heights, keyed by sourceHash. Server-fed
 * (documents#show props) so the loading figure reserves its final height and
 * the async render lands with zero layout shift on repeat loads. The same
 * hints size the static preview's skeleton (DocumentPreviewHtml), keeping the
 * preview → editor swap pixel-identical. */
export type MermaidRenderHints = Record<string, number>

export const mermaidRenderHintsCtx = $ctx<MermaidRenderHints, 'mermaidRenderHints'>(
  {},
  'mermaidRenderHints',
)

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

/** Fired (bubbling) on a diagram figure once its SVG is in the DOM, so the
 * editor can re-measure heights and persist fresh render hints. */
export const MERMAID_RENDERED_EVENT = 'thinkroom:mermaid-rendered'

const renderDiagram = async (figure: HTMLElement, source: string): Promise<void> => {
  if (!source.trim()) throw new Error('Empty Mermaid source')

  const mermaid = await loadMermaid()
  const parsed = await mermaid.parse(source, { suppressErrors: true })
  if (!parsed) throw new Error('Invalid Mermaid source')

  const id = `thinkroom-mermaid-${++renderSequence}`
  // Mermaid measures the diagram in a scratch element. Left to its default it
  // appends a plain div to <body>, which momentarily extends the page by the
  // diagram's height — a visible scrollbar jump on every load. A fixed,
  // hidden host keeps the measurement pass out of the document's layout
  // (visibility:hidden still allows getBBox, display:none would not).
  const measureHost = document.createElement('div')
  measureHost.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;contain:layout size;'
  document.body.appendChild(measureHost)
  let svg: string
  try {
    ;({ svg } = await mermaid.render(id, source, measureHost))
  } finally {
    measureHost.remove()
  }
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
  figure.dispatchEvent(new CustomEvent(MERMAID_RENDERED_EVENT, { bubbles: true }))
}

const diagramWidget = (
  position: number,
  source: string,
  hints: MermaidRenderHints,
): Decoration => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false
  const hash = sourceHash(source)

  return Decoration.widget(
    position,
    () => {
      const figure = document.createElement('figure')
      figure.className = 'mermaid-diagram'
      figure.contentEditable = 'false'
      figure.dataset.state = 'loading'
      figure.dataset.sourceHash = hash
      figure.setAttribute('aria-label', 'Mermaid diagram')
      // Reserve the diagram's persisted height before mermaid runs. Kept as
      // min-height after render: a slightly-smaller rerender pads instead of
      // shifting, and the next snapshot re-measures.
      const hint = hints[hash]
      if (typeof hint === 'number' && hint > 0) figure.style.minHeight = `${hint}px`
      figure.replaceChildren(statusElement('Rendering diagram…'))

      timer = setTimeout(() => {
        timer = null
        if (destroyed || !figure.isConnected) return
        void renderDiagram(figure, source).catch(() => {
          if (destroyed || !figure.isConnected) return
          figure.dataset.state = 'error'
          // The dashed error box is intentionally compact; a stale reserved
          // height would hold a big blank frame around a one-line notice.
          figure.style.minHeight = ''
          figure.replaceChildren(statusElement('Couldn’t render this Mermaid diagram.'))
        })
      }, RENDER_DELAY_MS)

      return figure
    },
    {
      side: -1,
      key: `mermaid-${position}-${hash}`,
      ignoreSelection: true,
      destroy: () => {
        destroyed = true
        if (timer) clearTimeout(timer)
      },
    },
  )
}

const decorationsFor = (doc: Node, hints: MermaidRenderHints): DecorationSet => {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    const language = typeof node.attrs.language === 'string'
      ? node.attrs.language.trim().toLowerCase()
      : ''
    if (node.type.name === 'code_block' && language === 'mermaid') {
      decorations.push(diagramWidget(position, node.textContent, hints))
    }
  })
  return DecorationSet.create(doc, decorations)
}

/** Measure rendered diagrams for the durable snapshot: sourceHash → px height.
 * The server persists these (Document#render_hints) and feeds them back to
 * both the static preview and the next editor mount. */
export const collectMermaidRenderHints = (root: HTMLElement): MermaidRenderHints => {
  const hints: MermaidRenderHints = {}
  root
    .querySelectorAll<HTMLElement>('figure.mermaid-diagram[data-state="ready"][data-source-hash]')
    .forEach((figure) => {
      const height = Math.round(figure.getBoundingClientRect().height)
      if (height > 0) hints[figure.dataset.sourceHash!] = height
    })
  return hints
}

/**
 * Persist fresh diagram geometry: a finished render changes measured heights
 * without a doc change, so the editor's update listener never fires for it.
 * Listens for rendered diagrams under `root` and calls `scheduleSnapshot` —
 * but only when a measured height actually differs from what the server
 * already knows. Diagrams re-render on every mount, so an ungated schedule
 * would re-POST the full document on every load. Returns the unbind.
 */
export const bindMermaidHintPersistence = (
  root: HTMLElement,
  serverHints: MermaidRenderHints | undefined,
  scheduleSnapshot: () => void,
): (() => void) => {
  const known: MermaidRenderHints = { ...serverHints }
  const onRendered = () => {
    const measured = collectMermaidRenderHints(root)
    const changed = Object.entries(measured).some(([hash, height]) => known[hash] !== height)
    if (!changed) return
    // Optimistic: the push is debounced and best-effort, and every doc
    // update re-sends all measured hints anyway.
    Object.assign(known, measured)
    scheduleSnapshot()
  }
  root.addEventListener(MERMAID_RENDERED_EVENT, onRendered)
  return () => root.removeEventListener(MERMAID_RENDERED_EVENT, onRendered)
}

/**
 * Render fenced Mermaid code blocks without replacing their document nodes.
 * The native code block remains the collaborative, serializable source; this
 * plugin only adds a derived browser preview immediately before it.
 */
const mermaidDecorations = $prose(
  (ctx) => new Plugin<DecorationSet>({
    key: mermaidDecorationsKey,
    state: {
      init: (_, state) => decorationsFor(state.doc, ctx.get(mermaidRenderHintsCtx.key)),
      apply: (transaction, decorations) => (
        transaction.docChanged
          ? decorationsFor(transaction.doc, ctx.get(mermaidRenderHintsCtx.key))
          : decorations.map(transaction.mapping, transaction.doc)
      ),
    },
    props: {
      decorations: (state) => mermaidDecorationsKey.getState(state) ?? null,
    },
  }),
)

export const mermaidDiagrams = [mermaidRenderHintsCtx, mermaidDecorations].flat()
