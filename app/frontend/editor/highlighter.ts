import { createHighlighter } from 'shiki'
import { createParser, type Parser } from '@milkdown/plugin-highlight/shiki'
import { connectedImport, isOffline } from './connection'

const LANGS = [
  'javascript', 'typescript', 'tsx', 'jsx', 'ruby', 'python', 'json',
  'bash', 'html', 'css', 'markdown', 'sql', 'yaml', 'go', 'rust',
]

let readyParser: Parser | null = null

/** Singleton shiki-backed parser for code block highlighting. */
const shikiParser = connectedImport<Parser>(async () => {
  const highlighter = await createHighlighter({ themes: ['github-light'], langs: LANGS })
  const base = createParser(highlighter, { theme: 'github-light' })
  // Unknown languages must degrade to plain text, not crash the editor.
  readyParser = (options) => {
    try {
      return base(options)
    } catch {
      return []
    }
  }
  return readyParser
})

/**
 * The pending-parser promise handed to prosemirror-highlight while shiki
 * loads. The plugin subscribes to it once per code block on every view
 * update and dispatches a full refresh transaction from every subscription
 * when it settles, so a document with N code blocks rebuilt every code
 * decoration N times per boot update (360 rebuilds on a 60-block document).
 * Subscriptions made in one synchronous burst (one plugin check) share a
 * single settlement; the rest never settle. The plugin only uses these to
 * learn that loading finished, so one wake-up per check is all it needs.
 * Extends Promise because the plugin identifies pending results with
 * `instanceof Promise`.
 */
class CoalescedLoad extends Promise<void> {
  static get [Symbol.species]() {
    return Promise
  }

  private claimed = false

  constructor(private readonly loaded: Promise<void>) {
    super(() => undefined)
  }

  override then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.claimed) return NEVER.then(onfulfilled, onrejected)
    this.claimed = true
    queueMicrotask(() => {
      this.claimed = false
    })
    return this.loaded.then(onfulfilled, onrejected)
  }
}

const NEVER = new Promise<never>(() => undefined)

let pendingParser: CoalescedLoad | null = null

// One load per page, started only while connected. Browsers remember a failed
// import, so a load that fails leaves code plain until the page is reloaded.
const startLoading = (): CoalescedLoad => {
  if (!pendingParser) {
    const loaded = shikiParser.whenOnline().then(() => undefined)
    loaded.catch(() => undefined)
    pendingParser = new CoalescedLoad(loaded)
  }
  return pendingParser
}

/** Start loading shiki before the first code block asks for it. Skipped
 * offline: a code block asks again and waits for the connection itself. */
export const warmHighlighter = (): void => {
  if (!isOffline()) startLoading()
}

/**
 * Non-blocking parser so the editor never waits on shiki to paint, and a
 * document without code never loads it. While the highlighter loads, it
 * returns the in-flight promise — prosemirror-highlight's documented lazy
 * protocol — and the plugin re-renders decorations when it resolves. Once
 * ready, it highlights synchronously. If shiki fails to load, code blocks stay
 * plain text.
 */
export function lazyShikiParser(): Parser {
  return (options) => (readyParser ? readyParser(options) : startLoading())
}
