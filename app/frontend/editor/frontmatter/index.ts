import remarkFrontmatter from 'remark-frontmatter'
import { $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import type { Node } from '@milkdown/kit/prose/model'
import { ySyncPluginKey } from 'y-prosemirror'
import { parse as parseYaml } from 'yaml'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { SKIP_PROVENANCE } from '../provenance'

/**
 * YAML frontmatter support. Without this, a seeded `---` block parses as a
 * thematic break plus loose paragraphs, and the first snapshot round-trip
 * mangles the document permanently (`***` + setext underline). The remark
 * extension turns the leading fence into a single mdast `yaml` node; the
 * node schema below stores its raw source in an atom node and renders it
 * as a read-only key/value table.
 */
// The third arg is required: $remark defaults the options ctx to `{}`, and
// remark-frontmatter treats `{}` as a (broken) custom matter instead of the
// 'yaml' preset it defaults to when called with no arguments at all.
const remarkFrontmatterPlugin = $remark('remarkFrontmatter', () => remarkFrontmatter, 'yaml')

const renderValue = (value: unknown, container: HTMLElement): void => {
  if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null)) {
    for (const item of value) {
      const chip = document.createElement('span')
      chip.className = 'frontmatter-chip'
      chip.textContent = String(item)
      container.appendChild(chip)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    const pre = document.createElement('pre')
    pre.className = 'frontmatter-nested'
    pre.textContent = JSON.stringify(value, null, 2)
    container.appendChild(pre)
    return
  }
  container.textContent = value === null || value === '' ? '—' : String(value)
}

/** Pretty table when the YAML parses to a map; raw <pre> otherwise. */
const renderFrontmatter = (value: string): HTMLElement => {
  const dom = document.createElement('div')
  dom.className = 'frontmatter-block'
  dom.setAttribute('data-frontmatter', '')
  dom.setAttribute('data-value', value)
  dom.contentEditable = 'false'

  const label = document.createElement('div')
  label.className = 'frontmatter-label'
  label.textContent = 'Frontmatter'
  dom.appendChild(label)

  let parsed: unknown = null
  try {
    parsed = parseYaml(value)
  } catch {
    // malformed YAML — fall through to the raw rendering
  }

  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const table = document.createElement('table')
    table.className = 'frontmatter-table'
    const tbody = document.createElement('tbody')
    for (const [key, entryValue] of Object.entries(parsed as Record<string, unknown>)) {
      const row = document.createElement('tr')
      const keyCell = document.createElement('th')
      keyCell.textContent = key
      const valueCell = document.createElement('td')
      renderValue(entryValue, valueCell)
      row.appendChild(keyCell)
      row.appendChild(valueCell)
      tbody.appendChild(row)
    }
    table.appendChild(tbody)
    dom.appendChild(table)
  } else {
    const raw = document.createElement('pre')
    raw.className = 'frontmatter-raw'
    raw.textContent = value
    dom.appendChild(raw)
  }

  return dom
}

/**
 * Atom node holding the raw YAML source in its `value` attr — attrs survive
 * y-prosemirror sync, carry no text for provenance/suggest marks to touch,
 * and round-trip losslessly (`toMarkdown` re-emits the source verbatim via
 * remark-frontmatter's stringify extension).
 */
export const frontmatterSchema = $nodeSchema('frontmatter', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  marks: '',
  attrs: {
    value: { default: '' },
  },
  parseDOM: [
    {
      tag: 'div[data-frontmatter]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute('data-value') ?? '' }),
    },
  ],
  toDOM: (node) => renderFrontmatter(node.attrs.value as string),
  parseMarkdown: {
    match: ({ type }) => type === 'yaml',
    runner: (state, node, type) => {
      state.addNode(type, { value: (node.value as string) ?? '' })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.attrs.value as string)
    },
  },
}))

const frontmatterGuardKey = new PluginKey('FRONTMATTER_GUARD')

const isRemote = (tr: Transaction): boolean => Boolean(tr.getMeta(ySyncPluginKey))

/**
 * Frontmatter is only frontmatter at the top of the file: a yaml block that
 * serializes mid-document re-parses as a thematic break plus paragraphs, so
 * a displaced node (content typed or pasted above it) would corrupt the
 * markdown the agent API serves. Local-transaction guard in the suggestGuard
 * mold — remote transactions are skipped because the displacing client fixes
 * its own edit and the fix syncs; both sides fixing concurrently could
 * duplicate the node through Yjs insert merging.
 */
const frontmatterGuard = $prose(
  () =>
    new Plugin({
      key: frontmatterGuardKey,
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some((tr) => tr.docChanged && !isRemote(tr))) return null
        const type = newState.schema.nodes.frontmatter
        if (!type) return null

        let pos = -1
        let found: Node | null = null
        newState.doc.forEach((child, offset) => {
          if (!found && child.type === type) {
            pos = offset
            found = child
          }
        })
        if (!found || pos <= 0) return null

        const tr = newState.tr.delete(pos, pos + (found as Node).nodeSize).insert(0, found)
        tr.setMeta(SKIP_PROVENANCE, true)
        tr.setMeta('addToHistory', false)
        return tr
      },
    }),
)

export const frontmatter: MilkdownPlugin[] = [
  remarkFrontmatterPlugin,
  frontmatterSchema,
  frontmatterGuard,
].flat()
