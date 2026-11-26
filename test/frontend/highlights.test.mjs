import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

globalThis.CSS = { highlights: new Map() }
globalThis.Highlight = class {
  constructor(...ranges) {
    this.ranges = ranges
  }
}
globalThis.document = { documentElement: { dataset: {} } }

const { clearHighlight, setHighlight } = await import('../../app/frontend/lib/highlights.ts')
const root = document.documentElement

test('a highlight enables its own styles the first time it is painted', () => {
  setHighlight('comment-anchor', [])
  assert.equal(root.dataset.highlights, undefined)

  setHighlight('comment-anchor', [{}])
  setHighlight('cw-1-fill', [{}], 2)
  setHighlight('comment-anchor', [{}])
  assert.equal(root.dataset.highlights, 'comment-anchor cw-1-fill')
  assert.equal(CSS.highlights.get('cw-1-fill').priority, 2)

  clearHighlight('comment-anchor')
  assert.equal(CSS.highlights.has('comment-anchor'), false)
  assert.equal(root.dataset.highlights, 'comment-anchor cw-1-fill')
})

// An unconditional ::highlight() rule adds one style to every element on the
// page, used or not, and a rule waiting for another name would never paint.
test('every highlight rule waits for its own name', () => {
  const styles = new URL('../../app/frontend/', import.meta.url)
  let rules = 0
  for (const file of readdirSync(styles, { recursive: true })) {
    if (!file.endsWith('.css')) continue
    const css = readFileSync(new URL(file, styles), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [, selector] of css.matchAll(/([^{}]*::highlight\([^{}]*)\{/g)) {
      for (const part of selector.split(/,(?![^(]*\))/)) {
        const name = /::highlight\(([\w-]+)\)/.exec(part)?.[1]
        assert.ok(part.includes(`:where([data-highlights~='${name}']) ::highlight(${name})`), `${file}: ${part.trim()}`)
        rules += 1
      }
    }
  }
  assert.ok(rules > 0)
})

test('highlights are registered only through setHighlight', () => {
  const source = new URL('../../app/frontend/', import.meta.url)
  for (const file of readdirSync(source, { recursive: true })) {
    if (!/\.tsx?$/.test(file) || file.replaceAll('\\', '/') === 'lib/highlights.ts') continue
    assert.doesNotMatch(readFileSync(new URL(file, source), 'utf8'), /CSS\.highlights\.set/, file)
  }
})
