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
 * Non-blocking parser so the editor never waits on shiki to paint.
 * While the highlighter loads, it returns the in-flight promise —
 * prosemirror-highlight's documented lazy protocol — and the plugin
 * re-renders decorations when it resolves. Once ready, it highlights
 * synchronously. If shiki fails to load, code blocks stay plain text.
 */
let loadedPromise: Promise<void> | null = null

export function lazyShikiParser(): Parser {
  loadedPromise ??= loadShikiParser().then(() => undefined)
  const loaded = loadedPromise
  return (options) => (readyParser ? readyParser(options) : loaded)
}
