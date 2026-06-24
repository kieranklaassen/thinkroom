import DOMPurify from 'dompurify'
import type { DefaultValue } from '@milkdown/kit/core'
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  type Node,
  type Schema,
} from '@milkdown/kit/prose/model'
import { normalizeSketchData } from './sketch/scene'

export type DocumentFormat = 'markdown' | 'html'
export type HtmlTrust = 'external' | 'snapshot'
export type SourceParser = (source: string) => Node | undefined

const ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  's',
  'del',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'ins',
  'figure',
  'figcaption',
]

const ALLOWED_ATTR = [
  'href',
  'title',
  'src',
  'alt',
  'start',
  'style',
  'colspan',
  'rowspan',
  'colwidth',
  'data-language',
  'data-item-type',
  'data-label',
  'data-list-type',
  'data-spread',
  'data-checked',
  'data-is-header',
  'data-provenance',
  'data-kind',
  'data-author',
  'data-state',
  'data-suggestion-id',
  'data-thinkroom-sketch',
  'data-sketch-id',
  'data-scene',
  'data-description',
  'data-format-version',
]

const ACTIVE_STORAGE_PATH =
  /^\/rails\/active_storage\/(?:blobs\/(?:redirect|proxy)|representations\/(?:redirect|proxy)|disk)\//
const TABLE_ALIGNMENT = /^\s*text-align:\s*(left|center|right)\s*;?\s*$/i
const PROVENANCE_KINDS = new Set(['human', 'ai'])
const PROVENANCE_STATES = new Set(['verbatim', 'pending', 'reviewed', 'endorsed'])
const MAX_METADATA_LENGTH = 255
const PROVENANCE_ATTRS = ['data-provenance', 'data-kind', 'data-author', 'data-state']
const SUGGESTION_ATTRS = ['data-suggestion-id', 'data-author']
const SKETCH_ATTRS = [
  'data-thinkroom-sketch',
  'data-sketch-id',
  'data-scene',
  'data-description',
  'data-format-version',
]
const THINKROOM_ATTRS = Array.from(
  new Set([...PROVENANCE_ATTRS, ...SUGGESTION_ATTRS, ...SKETCH_ATTRS]),
)

const removeAttrs = (element: Element, attrs: string[]) => {
  attrs.forEach((attr) => element.removeAttribute(attr))
}

const codePointLength = (value: string) => Array.from(value).length

const validActiveStorageSrc = (source: string): boolean => {
  if (
    !source.startsWith('/') ||
    source.startsWith('//') ||
    source.includes('\\') ||
    /%(?:2f|5c)/i.test(source)
  ) {
    return false
  }

  try {
    const parsed = new URL(source, window.location.origin)
    const rawPath = source.split(/[?#]/, 1)[0]
    const decodedPath = decodeURIComponent(rawPath)
    if (parsed.origin !== window.location.origin || parsed.search || parsed.hash) return false
    if (decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return false
    return ACTIVE_STORAGE_PATH.test(decodedPath)
  } catch {
    return false
  }
}

const sanitizeMetadata = (element: HTMLElement, trust: HtmlTrust) => {
  const metadata = Object.fromEntries(
    THINKROOM_ATTRS.map((attr) => [attr, element.getAttribute(attr)]),
  )
  removeAttrs(element, THINKROOM_ATTRS)
  if (trust !== 'snapshot') return

  const author = metadata['data-author'] ?? ''
  const validProvenance =
    metadata['data-provenance'] !== null &&
    element.tagName === 'SPAN' &&
    PROVENANCE_KINDS.has(metadata['data-kind'] ?? '') &&
    PROVENANCE_STATES.has(metadata['data-state'] ?? '') &&
    codePointLength(author) <= MAX_METADATA_LENGTH
  if (validProvenance) {
    element.setAttribute('data-provenance', '')
    element.setAttribute('data-kind', metadata['data-kind']!)
    element.setAttribute('data-author', author)
    element.setAttribute('data-state', metadata['data-state']!)
  }

  const suggestionId = metadata['data-suggestion-id'] ?? ''
  const validSuggestion =
    (element.tagName === 'INS' || element.tagName === 'DEL') &&
    suggestionId.length > 0 &&
    codePointLength(suggestionId) <= MAX_METADATA_LENGTH &&
    codePointLength(author) <= MAX_METADATA_LENGTH
  if (validSuggestion) {
    element.setAttribute('data-suggestion-id', suggestionId)
    element.setAttribute('data-author', author)
  }

  if (element.tagName === 'FIGURE' && metadata['data-thinkroom-sketch'] !== null) {
    try {
      const validSketch = normalizeSketchData({
        id: metadata['data-sketch-id'],
        formatVersion: Number(metadata['data-format-version']),
        description: metadata['data-description'],
        scene: JSON.parse(metadata['data-scene'] ?? ''),
      })
      if (validSketch) {
        for (const attr of SKETCH_ATTRS) element.setAttribute(attr, metadata[attr] ?? '')
      }
    } catch {
      // Invalid trusted metadata stays stripped.
    }
  }
}

/**
 * Browser-side counterpart to HtmlDocumentSanitizer. The server remains the
 * persistence boundary; this prevents unsafe or unsupported DOM from ever
 * entering the collaborative document through seeds, suggestions, or paste.
 */
export function sanitizeHtml(source: string, trust: HtmlTrust = 'external'): string {
  const sanitized = DOMPurify.sanitize(source, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
  const template = document.createElement('template')
  template.innerHTML = sanitized

  for (const element of Array.from(template.content.querySelectorAll<HTMLElement>('*'))) {
    if (
      element.tagName === 'IMG' &&
      !validActiveStorageSrc(element.getAttribute('src') ?? '')
    ) {
      element.remove()
      continue
    }

    if (element.hasAttribute('style')) {
      const match = TABLE_ALIGNMENT.exec(element.getAttribute('style') ?? '')
      if ((element.tagName === 'TD' || element.tagName === 'TH') && match) {
        element.setAttribute('style', `text-align: ${match[1].toLowerCase()}`)
      } else {
        element.removeAttribute('style')
      }
    }

    sanitizeMetadata(element, trust)
  }

  const container = document.createElement('div')
  container.append(template.content.cloneNode(true))
  return container.innerHTML
}

export function htmlDefaultValue(source: string, trust: HtmlTrust = 'external'): DefaultValue {
  const dom = document.createElement('div')
  dom.innerHTML = sanitizeHtml(source, trust)
  return { type: 'html', dom }
}

export function parseHtml(schema: Schema, source: string, trust: HtmlTrust = 'external'): Node {
  const { dom } = htmlDefaultValue(source, trust) as { type: 'html'; dom: HTMLElement }
  return ProseMirrorDOMParser.fromSchema(schema).parse(dom)
}

export function serializeHtml(doc: Node, schema: Schema): string {
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content))
  return sanitizeHtml(container.innerHTML, 'snapshot')
}

export function sourceParser(
  format: DocumentFormat,
  markdownParser: SourceParser,
  schema: Schema,
): SourceParser {
  if (format === 'markdown') return markdownParser
  return (source) => parseHtml(schema, source, 'external')
}
