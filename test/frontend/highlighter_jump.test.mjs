import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'

// The jump needs neither the editor setup nor the highlighter's own commands.
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  '@milkdown/kit/core': stub('export const editorViewCtx = {}'),
  '../../editor/text_highlighter': stub(
    'export const HIGHLIGHT_COLORS = [];' +
      ['applyHighlight', 'collectHighlights', 'removeHighlight', 'selectionHighlightColor']
        .map((name) => `export const ${name} = () => []`).join(';'),
  ),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
    if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:')) {
      const file = `${path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)}.ts`
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { useHighlighter } = await import('../../app/frontend/pages/documents/use_highlighter.ts')

const schema = new Schema({
  nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
})

const IN_EDITOR = {}

// A page 800px tall whose selected text sits at `top`; `focusNode` is where the
// browser's own selection is.
function fakePage({ top, focusNode }) {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('A blue run here.')])])
  const page = { pageScrolls: [], editorScrolls: 0, focused: false }
  page.view = {
    state: EditorState.create({ doc }),
    dom: { contains: (node) => node === IN_EDITOR },
    coordsAtPos: () => ({ top, bottom: top + 20 }),
    dispatch(tr) {
      // ProseMirror ignores the request while the selection is elsewhere.
      if (tr.scrolledIntoView && focusNode === IN_EDITOR) page.editorScrolls += 1
      page.view.state = page.view.state.apply(tr)
    },
    focus() { page.focused = true },
  }
  globalThis.document = { getSelection: () => ({ focusNode }) }
  globalThis.window = { innerHeight: 800, scrollBy: ({ top }) => page.pageScrolls.push(top) }
  return page
}

const jump = (page, snippet) => jumper((run) => run({ get: () => page.view }))(snippet)

function jumper(action) {
  let result
  const Probe = () => {
    result = useHighlighter({
      handle: { editor: { action } },
      // Nothing has been selected since the page loaded.
      viewRef: { current: null },
      docTick: 0, textTarget: null, names: {}, canWrite: true, effectiveMode: 'edit',
    })
    return null
  }
  renderToString(createElement(Probe))
  return result.jumpToHighlight
}

const SNIPPET = { from: 3, to: 11, text: 'blue run' }
const selectedText = ({ state }) => state.doc.textBetween(state.selection.from, state.selection.to)

test('a legend snippet jumps before anything was selected in the editor', () => {
  const page = fakePage({ top: 5000, focusNode: null })
  jump(page, SNIPPET)
  assert.equal(selectedText(page.view), 'blue run')
  assert.deepEqual(page.pageScrolls, [5000 - 320])
  assert.ok(page.focused)
})

test('a snippet already on screen is selected without scrolling the page', () => {
  const page = fakePage({ top: 300, focusNode: null })
  jump(page, SNIPPET)
  assert.equal(selectedText(page.view), 'blue run')
  assert.deepEqual(page.pageScrolls, [])
})

test('the editor does the scrolling once the selection is inside it', () => {
  const page = fakePage({ top: 5000, focusNode: IN_EDITOR })
  jump(page, SNIPPET)
  assert.equal(page.editorScrolls, 1)
  assert.deepEqual(page.pageScrolls, [])
})

test('a snippet past the end of the document is ignored', () => {
  const page = fakePage({ top: 5000, focusNode: null })
  const before = page.view.state
  jump(page, { ...SNIPPET, to: 999 })
  assert.equal(page.view.state, before)
  assert.deepEqual(page.pageScrolls, [])
})

test('a jump while the editor is torn down does nothing', () => {
  const tornDown = jumper(() => { throw new Error('editor destroyed') })
  assert.doesNotThrow(() => tornDown(SNIPPET))
})
