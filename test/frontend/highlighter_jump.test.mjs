import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { ySyncPlugin } from 'y-prosemirror'
import * as Y from 'yjs'

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

const { dispatchIntoView } = await import('../../app/frontend/lib/scroll_to_selection.ts')
const { scrollSettlePlugin } = await import('../../app/frontend/editor/scroll_settle.ts')

const schema = new Schema({
  nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
})

const IN_EDITOR = {}

globalThis.Element = class {
  constructor(rect) { this.getBoundingClientRect = rect }
  // Nothing here sits in code, which scrolls sideways.
  closest(selector) { return selector === 'pre code' ? null : this }
}

// A page 800px tall whose selected text sits at `top`, under a 44px header;
// `focusNode` is where the browser's own selection is. `skipped` is how far the
// text really sits below its block's top while the block is not rendered: its
// coordinates read 0/0 until a frame has passed with the block on screen, and
// `grows` is what the blocks above then add.
function fakePage({ top, focusNode, skipped = null, grows = 0, dockTop = null, plugins = [] }) {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('A blue run here.')])])
  const page = { pageScrolls: [], editorScrolls: 0, focused: false, top, frames: [] }
  let rendered = skipped === null
  const onScreen = () => page.top > -40 && page.top < 800
  const block = new Element(() => ({ top: page.top, bottom: page.top + 40 }))
  page.textTop = () => page.top + (skipped ?? 0)
  page.view = {
    state: EditorState.create({ doc, plugins: [scrollSettlePlugin(), ...plugins] }),
    isDestroyed: false,
    dom: { contains: (node) => node === IN_EDITOR },
    domAtPos: () => ({ node: block }),
    coordsAtPos() {
      if (page.view.isDestroyed) throw new Error('view destroyed')
      return rendered ? { top: page.textTop(), bottom: page.textTop() + 20 } : { top: 0, bottom: 0 }
    },
    dispatch(tr) {
      // ProseMirror ignores the request while the selection is elsewhere.
      if (tr.scrolledIntoView && focusNode === IN_EDITOR) page.editorScrolls += 1
      page.view.state = page.view.state.apply(tr)
    },
    focus() { page.focused = true },
    hasFocus: () => false,
  }
  // Blocks render after a frame's callbacks; the ones above grow a frame later.
  let renderedFor = 0
  page.frame = () => {
    const callbacks = page.frames.splice(0)
    callbacks.forEach((callback) => callback())
    if (onScreen()) rendered = true
    if (rendered && ++renderedFor === 2) page.top += grows
  }
  page.settle = () => { for (let i = 0; i < 10; i += 1) page.frame() }
  const chrome = {
    '.doc-header': { top: 0, bottom: 44, height: 44 },
    '.mobile-dock': dockTop === null ? null : { top: dockTop, bottom: 800, height: 800 - dockTop },
  }
  globalThis.document = {
    getSelection: () => ({ focusNode }),
    querySelector: (selector) => chrome[selector] && { getBoundingClientRect: () => chrome[selector] },
  }
  globalThis.requestAnimationFrame = (callback) => page.frames.push(callback)
  const listeners = new EventTarget()
  page.input = (type) => listeners.dispatchEvent(new Event(type))
  globalThis.window = {
    innerHeight: 800,
    addEventListener: listeners.addEventListener.bind(listeners),
    scrollBy: ({ top }) => { page.pageScrolls.push(top); page.top -= top },
  }
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
  page.settle()
  assert.equal(selectedText(page.view), 'blue run')
  assert.equal(page.textTop(), 320)
  assert.ok(page.focused)
})

test('a snippet in a block that is not rendered yet lands on screen', () => {
  const page = fakePage({ top: 5000, focusNode: null, skipped: 600 })
  jump(page, SNIPPET)
  page.settle()
  assert.equal(page.textTop(), 320)
})

test('a jump holds its text in place while the blocks around it render', () => {
  const page = fakePage({ top: 5000, focusNode: null, skipped: 600, grows: 700 })
  jump(page, SNIPPET)
  page.settle()
  assert.equal(page.textTop(), 320)
})

test('a jump stops when the editor goes away between its frames', () => {
  for (let frames = 0; frames < 6; frames += 1) {
    const page = fakePage({ top: 5000, focusNode: null, skipped: 600, grows: 700 })
    jump(page, SNIPPET)
    for (let i = 0; i < frames; i += 1) page.frame()
    page.view.isDestroyed = true
    const scrolls = page.pageScrolls.length
    assert.doesNotThrow(() => page.settle())
    assert.equal(page.pageScrolls.length, scrolls)
  }
})

test('text behind the header or the dock is not on screen', () => {
  const behindHeader = fakePage({ top: 20, focusNode: null })
  jump(behindHeader, SNIPPET)
  assert.equal(behindHeader.textTop(), 320)

  const behindDock = fakePage({ top: 750, focusNode: null, dockTop: 740 })
  jump(behindDock, SNIPPET)
  assert.equal(behindDock.textTop(), 320)
})

test('a snippet already on screen is selected without scrolling the page', () => {
  const page = fakePage({ top: 300, focusNode: null })
  jump(page, SNIPPET)
  assert.equal(selectedText(page.view), 'blue run')
  page.settle()
  assert.deepEqual(page.pageScrolls, [])
})

test('a repeated jump lands like the first one, without the editor scrolling', () => {
  for (const top of [5000, -5000, 20]) {
    const page = fakePage({ top, focusNode: IN_EDITOR, skipped: 0 })
    if (top === 20) page.frame()
    jump(page, SNIPPET)
    page.settle()
    assert.equal(page.textTop(), 320)
    assert.equal(page.editorScrolls, 0)
  }
})

const INPUTS = ['wheel', 'touchmove', 'pointerdown', 'keydown']

test('a person taking over stops the jump from any frame on', () => {
  const pages = [
    { top: 5000, focusNode: null, skipped: 600, grows: 700 },
    { top: 20, focusNode: null, grows: 700 },
  ]
  for (const options of pages) {
    for (const input of INPUTS) {
      for (let frames = 0; frames < 6; frames += 1) {
        const page = fakePage(options)
        jump(page, SNIPPET)
        for (let i = 0; i < frames; i += 1) page.frame()
        page.input(input)
        page.top -= 400
        const scrolls = page.pageScrolls.length
        page.settle()
        assert.equal(page.pageScrolls.length, scrolls, `${input} after ${frames} frames`)
      }
    }
  }
})

test('selecting something else stops the jump from any frame on', () => {
  for (let frames = 0; frames < 6; frames += 1) {
    const page = fakePage({ top: 5000, focusNode: null, skipped: 600, grows: 700 })
    jump(page, SNIPPET)
    for (let i = 0; i < frames; i += 1) page.frame()
    const { state } = page.view
    page.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2)))
    const scrolls = page.pageScrolls.length
    page.settle()
    assert.equal(page.pageScrolls.length, scrolls)
  }
})

const UNRENDERED = { top: 5000, focusNode: null, skipped: 600, grows: 700 }

// A page bound to a Yjs document by the plugin the editor uses, and the same
// document as a peer holds it. Remote edits reach the editor as they really do:
// the whole body replaced, the selection restored.
function sharedPage(t) {
  const paragraph = (text) => {
    const node = new Y.XmlElement('paragraph')
    node.insert(0, [new Y.XmlText(text)])
    return node
  }
  const peer = new Y.Doc()
  const body = peer.getXmlFragment('body')
  body.insert(0, [paragraph('Intro.'), paragraph('A blue run here.')])
  const mine = new Y.Doc()
  Y.applyUpdate(mine, Y.encodeStateAsUpdate(peer))

  const sync = ySyncPlugin(mine.getXmlFragment('body'))
  const page = fakePage({ ...UNRENDERED, plugins: [sync] })
  const bound = sync.spec.view(page.view)
  t.after(() => bound.destroy())
  page.peerEdits = (edit) => {
    edit(body, paragraph)
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(peer))
  }
  return page
}

const SHARED_SNIPPET = { from: 11, to: 19, text: 'blue run' }

const PEER_EDITS = {
  'a paragraph added above': (body, paragraph) => body.insert(0, [paragraph('New from a peer.')]),
  'a paragraph removed above': (body) => body.delete(0, 1),
  'text added above': (body) => body.get(0).get(0).insert(0, 'Longer '),
  'text added before it in its paragraph': (body) => body.get(1).get(0).insert(0, 'See '),
}

test("a peer's edit before the target does not stop the jump, whichever frame it lands in", (t) => {
  for (const [name, edit] of Object.entries(PEER_EDITS)) {
    for (let frames = 0; frames < 6; frames += 1) {
      const page = sharedPage(t)
      jump(page, SHARED_SNIPPET)
      const { head } = page.view.state.selection
      for (let i = 0; i < frames; i += 1) page.frame()
      page.peerEdits(edit)
      assert.notEqual(page.view.state.selection.head, head)
      page.settle()
      assert.equal(selectedText(page.view), 'blue run', name)
      assert.equal(page.textTop(), 320, `${name} after ${frames} frames`)
    }
  }
})

test('selecting something else stops the jump after a peer edit too, even where the target was', (t) => {
  for (let frames = 0; frames < 4; frames += 1) {
    const page = sharedPage(t)
    jump(page, SHARED_SNIPPET)
    const { head } = page.view.state.selection
    for (let i = 0; i < frames; i += 1) page.frame()
    page.peerEdits(PEER_EDITS['a paragraph added above'])
    const { state } = page.view
    page.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, head)))
    const scrolls = page.pageScrolls.length
    page.settle()
    assert.equal(page.pageScrolls.length, scrolls, `after ${frames} frames`)
  }
})

const TARGET_REMOVALS = {
  'its paragraph deleted': (body) => body.delete(1, 1),
  'its text deleted': (body) => body.get(1).get(0).delete(0, 16),
  'the body replaced': (body, paragraph) => {
    body.delete(0, 2)
    body.insert(0, [paragraph('All new.'), paragraph('Nothing kept.')])
  },
}

test('a peer removing the target stops the jump, whichever frame it lands in', (t) => {
  for (const [name, edit] of Object.entries(TARGET_REMOVALS)) {
    for (let frames = 0; frames < 4; frames += 1) {
      const page = sharedPage(t)
      jump(page, SHARED_SNIPPET)
      for (let i = 0; i < frames; i += 1) page.frame()
      page.peerEdits(edit)
      const scrolls = page.pageScrolls.length
      page.settle()
      assert.equal(page.pageScrolls.length, scrolls, `${name} after ${frames} frames`)
    }
  }
})

test('a remote change that cannot put the selection back stops the jump', () => {
  const page = fakePage(UNRENDERED)
  const { tr, doc } = page.view.state
  dispatchIntoView(page.view, tr.setSelection(TextSelection.create(doc, 3)))
  const { state } = page.view
  page.view.dispatch(state.tr.replaceWith(0, state.doc.content.size, state.doc.content).setMeta('y-sync$', { isChangeOrigin: true }))
  const scrolls = page.pageScrolls.length
  page.settle()
  assert.equal(page.pageScrolls.length, scrolls)
})

test('a local change before the target does not stop the jump, and one replacing it does', () => {
  for (let frames = 0; frames < 4; frames += 1) {
    for (const [change, lands] of [[(tr) => tr.insertText('Oh, ', 1, 1), true], [(tr) => tr.insertText('typed', 3, 11), false]]) {
      const page = fakePage(UNRENDERED)
      jump(page, SNIPPET)
      for (let i = 0; i < frames; i += 1) page.frame()
      page.view.dispatch(change(page.view.state.tr))
      const scrolls = page.pageScrolls.length
      page.settle()
      if (lands) assert.equal(page.textTop(), 320, `after ${frames} frames`)
      else assert.equal(page.pageScrolls.length, scrolls, `after ${frames} frames`)
    }
  }
})

test('input before a jump does not stop it', () => {
  const page = fakePage({ top: 5000, focusNode: null })
  page.input('pointerdown')
  jump(page, SNIPPET)
  page.settle()
  assert.equal(page.textTop(), 320)
})

test('a snippet past the end of the document is ignored', () => {
  const page = fakePage({ top: 5000, focusNode: null })
  const before = page.view.state
  jump(page, { ...SNIPPET, to: 999 })
  assert.equal(page.view.state, before)
  page.settle()
  assert.deepEqual(page.pageScrolls, [])
})

test('a jump while the editor is torn down does nothing', () => {
  const tornDown = jumper(() => { throw new Error('editor destroyed') })
  assert.doesNotThrow(() => tornDown(SNIPPET))
})
