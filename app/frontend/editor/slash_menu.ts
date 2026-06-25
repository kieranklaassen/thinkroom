import type { Ctx } from '@milkdown/kit/ctx'
import { setBlockType, wrapIn } from '@milkdown/kit/prose/commands'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { SlashProvider, slashFactory } from '@milkdown/kit/plugin/slash'
import { sketchControlsCtx } from './sketch'

interface SlashItem {
  label: string
  detail: string
  icon: string
  keywords: string
  run: (view: EditorView) => void
  available: (state: EditorState) => boolean
}

const slash = slashFactory('THINKROOM_INSERT_MENU')

const nodeAvailable = (name: string) => (state: EditorState) => Boolean(state.schema.nodes[name])

const deleteSlashQuery = (view: EditorView) => {
  const { $from } = view.state.selection
  view.dispatch(view.state.tr.delete($from.start(), $from.pos))
}

const setBlock = (name: string, attrs?: Record<string, unknown>) => (view: EditorView) => {
  const type = view.state.schema.nodes[name]
  if (type) setBlockType(type, attrs)(view.state, view.dispatch)
}

const wrapBlock = (name: string) => (view: EditorView) => {
  const type = view.state.schema.nodes[name]
  if (type) wrapIn(type)(view.state, view.dispatch)
}

const wrapList = (name: string, checked?: boolean) => (view: EditorView) => {
  const type = view.state.schema.nodes[name]
  const paragraph = view.state.schema.nodes.paragraph
  if (!type || !paragraph) return
  setBlockType(paragraph)(view.state, view.dispatch)
  if (!wrapInList(type)(view.state, view.dispatch)) return
  if (checked === undefined) return

  const { $from } = view.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'list_item') continue
    view.dispatch(
      view.state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked }),
    )
    break
  }
}

const insertDivider = (view: EditorView) => {
  const { state } = view
  const rule = state.schema.nodes.hr
  const paragraph = state.schema.nodes.paragraph
  if (!rule || !paragraph) return
  const { $from } = state.selection
  const from = $from.before($from.depth)
  const to = $from.after($from.depth)
  const tr = state.tr.replaceWith(from, to, [rule.create(), paragraph.create()])
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1), 1))
  view.dispatch(tr.scrollIntoView())
}

const buildItems = (ctx: Ctx): SlashItem[] => [
  {
    label: 'Text', detail: 'Plain paragraph', icon: 'T', keywords: 'paragraph text',
    run: setBlock('paragraph'), available: nodeAvailable('paragraph'),
  },
  ...[1, 2, 3].map((level): SlashItem => ({
    label: `Heading ${level}`,
    detail: level === 1 ? 'Page title' : `Section heading ${level}`,
    icon: `H${level}`,
    keywords: `heading h${level} title`,
    run: setBlock('heading', { level }),
    available: nodeAvailable('heading'),
  })),
  {
    label: 'Bulleted list', detail: 'Simple unordered list', icon: '•', keywords: 'bullet list unordered',
    run: wrapList('bullet_list'), available: nodeAvailable('bullet_list'),
  },
  {
    label: 'Numbered list', detail: 'Ordered list', icon: '1.', keywords: 'number ordered list',
    run: wrapList('ordered_list'), available: nodeAvailable('ordered_list'),
  },
  {
    label: 'To-do list', detail: 'Track something to do', icon: '✓', keywords: 'todo task checkbox check',
    run: wrapList('bullet_list', false), available: nodeAvailable('bullet_list'),
  },
  {
    label: 'Quote', detail: 'Capture a quotation', icon: '“', keywords: 'quote blockquote citation',
    run: wrapBlock('blockquote'), available: nodeAvailable('blockquote'),
  },
  {
    label: 'Code block', detail: 'Code with syntax highlighting', icon: '</>', keywords: 'code pre snippet',
    run: setBlock('code_block'), available: nodeAvailable('code_block'),
  },
  {
    label: 'Divider', detail: 'Separate ideas', icon: '—', keywords: 'divider rule separator hr',
    run: insertDivider, available: nodeAvailable('hr'),
  },
  {
    label: 'Sketch', detail: 'Draw directly in the document', icon: '⌁', keywords: 'sketch draw canvas image excalidraw',
    run: () => ctx.get(sketchControlsCtx.key).insert(),
    available: () => ctx.get(sketchControlsCtx.key).enabled(),
  },
]

class SlashMenuView {
  private readonly menu = document.createElement('div')
  private readonly provider: SlashProvider
  private readonly items: SlashItem[]
  private filtered: SlashItem[] = []
  private selectedIndex = 0
  private query = ''

  constructor(ctx: Ctx, private view: EditorView) {
    this.items = buildItems(ctx)
    this.menu.className = 'thinkroom-slash-menu'
    this.menu.setAttribute('role', 'listbox')
    this.menu.setAttribute('aria-label', 'Insert block')
    this.provider = new SlashProvider({
      content: this.menu,
      root: document.body,
      debounce: 0,
      offset: 7,
      shouldShow: (currentView) => {
        const text = this.provider.getContent(
          currentView,
          (node) => node.type.name === 'paragraph' || node.type.name === 'heading',
        )
        const { selection } = currentView.state
        if (
          text == null ||
          !text.startsWith('/') ||
          !selection.empty ||
          selection.$from.parentOffset !== selection.$from.parent.content.size
        ) return false
        this.query = text.slice(1).trim().toLowerCase()
        this.render()
        return true
      },
    })
    this.provider.onHide = () => this.menu.removeAttribute('data-visible')
    this.provider.onShow = () => this.menu.setAttribute('data-visible', 'true')
    this.provider.update(view)
  }

  update = (view: EditorView) => {
    this.view = view
    // SlashProvider debounces updates. Passing previousState lets a later
    // decoration-only update cancel the text-change update, then short-circuit
    // as "same" before shouldShow sees the slash. Always evaluate the latest
    // state; the provider's own debounce still coalesces the work.
    this.provider.update(view)
  }

  handleKeyDown = (event: KeyboardEvent): boolean => {
    if (this.menu.dataset.show !== 'true') return false
    if (event.key === 'Escape') {
      this.provider.hide()
      return true
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (this.filtered.length === 0) return true
      const direction = event.key === 'ArrowDown' ? 1 : -1
      this.selectedIndex = (this.selectedIndex + direction + this.filtered.length) % this.filtered.length
      this.render()
      return true
    }
    if (event.key === 'Enter' && this.filtered[this.selectedIndex]) {
      this.choose(this.filtered[this.selectedIndex])
      return true
    }
    return false
  }

  destroy = () => {
    this.provider.destroy()
    this.menu.remove()
  }

  private choose = (item: SlashItem) => {
    this.provider.hide()
    deleteSlashQuery(this.view)
    item.run(this.view)
    this.view.focus()
  }

  private render = () => {
    const previousLabel = this.filtered[this.selectedIndex]?.label
    this.filtered = this.items.filter((item) => {
      if (!item.available(this.view.state)) return false
      const search = `${item.label} ${item.detail} ${item.keywords}`.toLowerCase()
      return !this.query || search.includes(this.query)
    })
    const previousIndex = this.filtered.findIndex((item) => item.label === previousLabel)
    this.selectedIndex = previousIndex >= 0 ? previousIndex : 0
    this.menu.replaceChildren()

    if (this.filtered.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'thinkroom-slash-empty'
      empty.textContent = 'No matching blocks'
      this.menu.append(empty)
      return
    }

    this.filtered.forEach((item, index) => {
      const button = document.createElement('button')
      const icon = document.createElement('span')
      const copy = document.createElement('span')
      const label = document.createElement('strong')
      const detail = document.createElement('small')
      button.type = 'button'
      button.className = 'thinkroom-slash-item'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(index === this.selectedIndex))
      if (index === this.selectedIndex) button.classList.add('is-active')
      icon.className = 'thinkroom-slash-icon'
      icon.textContent = item.icon
      copy.className = 'thinkroom-slash-copy'
      label.textContent = item.label
      detail.textContent = item.detail
      copy.append(label, detail)
      button.append(icon, copy)
      button.addEventListener('pointerenter', () => {
        if (this.selectedIndex === index) return
        this.selectedIndex = index
        this.render()
      })
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        this.choose(item)
      })
      this.menu.append(button)
    })
    this.menu.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }
}

export const configureSlashMenu = (ctx: Ctx) => {
  let activeMenu: SlashMenuView | undefined
  ctx.set(slash.key, {
    view: (view) => {
      activeMenu = new SlashMenuView(ctx, view)
      return activeMenu
    },
    props: {
      handleKeyDown: (_view, event) => activeMenu?.handleKeyDown(event) ?? false,
    },
  })
}

export const slashMenu = slash
