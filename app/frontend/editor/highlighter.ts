import { createHighlighter } from 'shiki'
import { createParser, type Parser } from '@milkdown/plugin-highlight/shiki'

const LANGS = [
  'javascript', 'typescript', 'tsx', 'jsx', 'ruby', 'python', 'json',
  'bash', 'html', 'css', 'markdown', 'sql', 'yaml', 'go', 'rust',
]

let parserPromise: Promise<Parser> | null = null

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
      return safe
    },
  )
  return parserPromise
}
