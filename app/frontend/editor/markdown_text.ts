import type { Ctx } from '@milkdown/kit/ctx'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'

type Handlers = NonNullable<ReturnType<typeof readOptions>['handlers']>
const readOptions = (ctx: Ctx) => ctx.get(remarkStringifyOptionsCtx)

const longestRun = (value: string): number =>
  Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length))

/**
 * Text saves as text. The editor's own handler writes a value that ends in
 * space without escaping it, and inline code with a line break in it could
 * end at a blank line. Titles, labels and markers stay on one line and hold no
 * tags for the same reason.
 */
export const configureMarkdownText = (ctx: Ctx): void => {
  const options = readOptions(ctx)
  const handlers: Handlers = options.handlers ?? {}
  const text = handlers.text
  const marked = (handler: Handlers['strong']): Handlers['strong'] =>
    handler &&
    ((node, parent, state, info) =>
      handler({ ...node, marker: node.marker === '_' ? '_' : '*' }, parent, state, info))
  ctx.set(remarkStringifyOptionsCtx, {
    ...options,
    unsafe: [
      ...(options.unsafe ?? []),
      ...['<', '`', '\n', '\r'].flatMap((character) =>
        ['titleQuote', 'titleApostrophe', 'destinationRaw', 'label', 'reference'].map(
          (inConstruct) => ({ character, inConstruct }) as NonNullable<typeof options.unsafe>[number],
        ),
      ),
    ],
    handlers: {
      ...handlers,
      strong: marked(handlers.strong),
      emphasis: marked(handlers.emphasis) as Handlers['emphasis'],
      text: (node, parent, state, info) => {
        const value = String(node.value)
        if (!text || !/[<`~[\]]/.test(value)) return text?.(node, parent, state, info) ?? value
        const end = /\s*$/.exec(value)![0]
        const start = value.slice(0, value.length - end.length)
        return state.safe(start, { ...info, after: end || info.after, encode: [] } as typeof info) + end
      },
      inlineCode: Object.assign(
        (node: { value?: unknown }, _parent: unknown, state: { stack: string[] }) => {
          const value = String(node.value).replace(/\s*[\r\n]\s*/g, ' ')
          const fence = '`'.repeat(longestRun(value) + 1)
          const pad = /^`|`$|^ .* $/.test(value) && /[^ ]/.test(value) ? ' ' : ''
          const serialized = fence + pad + value + pad + fence
          return state.stack.includes('tableCell') ? serialized.replace(/\|/g, '\\$&') : serialized
        },
        { peek: () => '`' },
      ),
    },
  })
}

export const escapeMarkupAttribute = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
