import assert from 'node:assert/strict'
import test from 'node:test'
import { Clock, Container, Ctx } from '@milkdown/kit/ctx'
import {
  commands,
  config,
  editorViewCtx,
  Editor,
  editorState,
  init,
  keymap,
  parser,
  parserCtx,
  pasteRule,
  prosePluginsCtx,
  schema,
  schemaCtx,
  serializer,
  serializerCtx,
  SerializerReady,
} from '@milkdown/kit/core'
import { EditorState } from '@milkdown/kit/prose/state'
import { ySyncPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'
import { addsHtml, htmlGuard, htmlGuardCtx, keepRefusedHtmlAsText } from '../../app/frontend/editor/html_guard.ts'
import { configureMarkdownText, escapeMarkupAttribute } from '../../app/frontend/editor/markdown_text.ts'
import { markdownPresets } from '../../app/frontend/editor/schema_attributes.ts'

// Milkdown's timers signal each other through window events.
const events = new EventTarget()
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
  globalThis[name] ??= events[name].bind(events)
}

async function buildEditor() {
  const ctx = new Ctx(new Container(), new Clock())
  const run = (plugin) => plugin(ctx)
  const core = [schema, parser, serializer, commands, keymap, pasteRule, editorState]
  const runners = [...core, init(Editor.make()), config(async (c) => configureMarkdownText(c))].map(run)
  runners.push(...[...markdownPresets, ...htmlGuard].map(run))
  runners.forEach((runner) => void runner?.())
  await ctx.wait(SerializerReady)
  await new Promise((resolve) => setTimeout(resolve, 20))
  // The empty-line serializer looks at the view's document.
  ctx.inject(editorViewCtx, { state: { doc: { lastChild: null } } })
  const guard = ctx.get(prosePluginsCtx).find((plugin) => plugin.key.startsWith('HTML_GUARD'))
  return { ctx, parse: ctx.get(parserCtx), serialize: ctx.get(serializerCtx), schema: ctx.get(schemaCtx), guard }
}

const htmlValues = (doc) => {
  const values = []
  doc.descendants((node) => {
    if (node.type.name === 'html') values.push(node.attrs.value)
  })
  return values
}

async function guarded(source, needsAccount = true) {
  const editor = await buildEditor()
  const notices = []
  editor.ctx.set(htmlGuardCtx.key, { needsAccount: () => needsAccount, onKeptAsText: () => notices.push(1) })
  const state = EditorState.create({ doc: editor.parse(source), plugins: [editor.guard] })
  return { ...editor, state, notices }
}

const insert = (state, parse, source) => state.tr.insert(state.doc.content.size, parse(source).content)

test('HTML added without an account becomes text, every line of it', async () => {
  const { state, parse, serialize, notices } = await guarded('Hello')
  const next = state.apply(insert(state, parse, '<div>\n<b>hi</b>\n</div>'))
  assert.deepEqual(htmlValues(next.doc), [])
  assert.match(next.doc.textContent, /<div>\n<b>hi<\/b>\n<\/div>/)
  assert.equal(notices.length, 1)
  assert.deepEqual(htmlValues(parse(serialize(next.doc))), [])
})

test('HTML added with an account stays HTML', async () => {
  const { state, parse, notices } = await guarded('Hello', false)
  assert.deepEqual(htmlValues(state.apply(insert(state, parse, '<b>x</b>')).doc), ['<b>', '</b>'])
  assert.equal(notices.length, 0)
})

test('existing HTML can be moved and restored, and not copied', async () => {
  const { state, parse, notices } = await guarded('Hello\n\n<mark>')
  const cut = state.apply(state.tr.delete(7, state.doc.content.size))
  assert.deepEqual(htmlValues(cut.doc), [])
  const pasted = cut.apply(insert(cut, parse, '<mark>'))
  assert.deepEqual(htmlValues(pasted.doc), ['<mark>'])
  assert.equal(notices.length, 0)
  const copied = pasted.apply(insert(pasted, parse, '<mark>'))
  assert.deepEqual(htmlValues(copied.doc), ['<mark>'])
  assert.equal(notices.length, 1)
})

test('what arrives from others is left alone', async () => {
  const { state, parse } = await guarded('Hello')
  const tr = insert(state, parse, '<i>').setMeta(ySyncPluginKey, { isChangeOrigin: true })
  assert.deepEqual(htmlValues(state.apply(tr).doc), ['<i>'])
})

test('a replacement that adds HTML is recognised', async () => {
  const { parse } = await buildEditor()
  assert.equal(addsHtml(parse('a <b>x</b>'), parse('<b>x</b> a')), false)
  assert.equal(addsHtml(parse('a <b>x</b>'), parse('a')), false)
  assert.equal(addsHtml(parse('a <b>x</b>'), parse('a <b>x</b> <b>')), true)
})

test('text saves as text', async () => {
  const { schema: built, serialize, parse } = await buildEditor()
  const save = (text, ...marks) =>
    serialize(built.node('doc', null, [built.node('paragraph', null, [built.text(text, marks)])]))
  for (const text of ['<b>', '<b> ', 'a <div> ', '<!-- x --> ', 'a < b ', 'x ', '1 <2']) {
    const saved = save(text)
    assert.deepEqual(htmlValues(parse(saved)), [], saved)
    assert.equal(parse(saved).textContent.trim(), text.trim())
  }
  for (const text of ['a\n\nx <b>', '`', 'a ` b', '``', ' a ', 'plain']) {
    const saved = save(text, built.marks.inlineCode.create())
    assert.deepEqual(htmlValues(parse(saved)), [], saved)
    assert.equal(parse(saved).textContent, text.replace(/\s*\n\s*/g, ' ').replace(/ +/g, ' '))
  }
  assert.equal(escapeMarkupAttribute('a\n\n"<b>'), 'a &quot;&lt;b>')
})

test('refused HTML becomes text, only what this page added and no more than was refused', () => {
  const server = new Y.Doc()
  const node = (value) => {
    const element = new Y.XmlElement('html')
    element.setAttribute('value', value)
    return element
  }
  const paragraph = new Y.XmlElement('paragraph')
  server.getXmlFragment('prosemirror').insert(0, [paragraph])
  paragraph.insert(0, [node('<i>')])

  const page = new Y.Doc()
  Y.applyUpdate(page, Y.encodeStateAsUpdate(server))
  const own = page.getXmlFragment('prosemirror').get(0)
  own.insert(1, [new Y.XmlText('typed'), node('<i>'), node('<i>'), node('<b\n x>')])

  assert.equal(keepRefusedHtmlAsText(page, { '<i>': 1, '<b x>': 1 }), 2)
  assert.equal(own.toString(), '<paragraph><html value="<i>"></html>typed<html value="<i>"></html><i><b<hardbreak isInline="true"></hardbreak> x></paragraph>')
  assert.equal(keepRefusedHtmlAsText(page, { '<u>': 1 }), 0)
})
