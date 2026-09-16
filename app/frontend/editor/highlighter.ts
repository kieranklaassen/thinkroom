import { createHighlighter } from 'shiki'
import { createParser, type Parser } from '@milkdown/plugin-highlight/shiki'

const LANGS = [
  'javascript', 'typescript', 'tsx', 'jsx', 'ruby', 'python', 'json',
  'bash', 'html', 'css', 'markdown', 'sql', 'yaml', 'go', 'rust',
]

let parserPromise: Promise<Parser> | null = null
let readyParser: Parser | null = null

/** Singleton shiki-backed parser for code block highlighting. */
export function loadShikiParser(): Promise<Parser> {
  parserPromise ??= createHighlighter({ themes: ['github-light'], langs: LANGS }).then(
    (highlighter) => {
      const base = createParser(highlighter, { theme: 'github-light' })
      // Unknown languages must degrade to plain text, not crash the editor.
      const safe: Parser = (options) => {
        try {
          return base(options)
        } catch {
          return []
        }
      }
      readyParser = safe
      return safe
    },
  )
  return parserPromise
}

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

/**
 * Non-blocking parser so the editor never waits on shiki to paint.
 * While the highlighter loads, it returns the in-flight promise —
 * prosemirror-highlight's documented lazy protocol — and the plugin
 * re-renders decorations when it resolves. Once ready, it highlights
 * synchronously. If shiki fails to load, code blocks stay plain text.
 */
let loadedPromise: Promise<void> | null = null

export function lazyShikiParser(): Parser {
  loadedPromise ??= loadShikiParser().then(() => undefined)
  const pending = new CoalescedLoad(loadedPromise)
  return (options) => (readyParser ? readyParser(options) : pending)
}
