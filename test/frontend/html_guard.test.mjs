import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith('file:')
    ) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      for (const candidate of [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
        `${base}.js`,
        `${base}.mjs`,
      ]) {
        if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const { Clock, Container, Ctx } = await import('@milkdown/kit/ctx')
const {
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
} = await import('@milkdown/kit/core')
const { EditorState } = await import('@milkdown/kit/prose/state')
const { ySyncPluginKey } = await import('y-prosemirror')
const Y = await import('yjs')
const { addsHtml, htmlGuard, htmlGuardCtx, keepRefusedHtmlAsText } = await import(
  '../../app/frontend/editor/html_guard.ts'
)
const { frontmatter } = await import('../../app/frontend/editor/frontmatter/index.ts')
const { configureMarkdownText, escapeMarkupAttribute } = await import(
  '../../app/frontend/editor/markdown_text.ts'
)
const { markdownPresets } = await import('../../app/frontend/editor/schema_attributes.ts')

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
  runners.push(...[...markdownPresets, ...frontmatter, ...htmlGuard].map(run))
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
  next.doc.check()
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

test('pasting a duplicate above existing HTML converts the new copy and keeps the original', async () => {
  const { state, parse, notices } = await guarded('First\n\nSecond <mark>')
  const next = state.apply(state.tr.insert(0, parse('<mark>').content))
  next.doc.check()
  assert.deepEqual(htmlValues(next.doc), ['<mark>'])
  assert.equal(notices.length, 1)
  // The first paragraph holds the newly pasted text; the original HTML node remains in the last paragraph.
  assert.equal(next.doc.firstChild.textContent, '<mark>')
  assert.deepEqual(htmlValues(next.doc.lastChild), ['<mark>'])
})

test('inline code with a pipe inside a GFM table cell stays escaped', async () => {
  const { serialize, parse } = await buildEditor()
  const doc = parse('| a | b |\n| - | - |\n| `x \\| <b>` | ok |\n')
  const saved = serialize(doc)
  assert.deepEqual(htmlValues(parse(saved)), [], saved)
  assert.match(saved, /`x \\\| <b>`/)
})

test('what arrives from others is left alone', async () => {
  const { state, parse } = await guarded('Hello')
  const tr = insert(state, parse, '<i>').setMeta(ySyncPluginKey, { isChangeOrigin: true })
  assert.deepEqual(htmlValues(state.apply(tr).doc), ['<i>'])
})

test('a replacement that adds HTML or HTML in frontmatter is recognised', async () => {
  const { parse } = await buildEditor()
  assert.equal(addsHtml(parse('a <b>x</b>'), parse('<b>x</b> a')), false)
  assert.equal(addsHtml(parse('a <b>x</b>'), parse('a')), false)
  assert.equal(addsHtml(parse('a <b>x</b>'), parse('a <b>x</b> <b>')), true)
  assert.equal(addsHtml(parse('Hello'), parse('---\ntitle: plain\n---\n\nHello')), false)
  assert.equal(addsHtml(parse('Hello'), parse('---\ntitle: <b>hi</b>\n---\n\nHello')), true)
  assert.equal(addsHtml(parse('---\ntitle: <b>hi</b>\n---\n\nHello'), parse('---\ntitle: <b>hi</b>\n---\n\nUpdated')), false)
})

test('changing an existing HTML node attribute or adding HTML frontmatter without an account converts it', async () => {
  const { state, schema: s, notices } = await guarded('Hello\n\n<mark>')
  let htmlPos = -1
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'html') htmlPos = pos
  })
  assert.ok(htmlPos >= 0)
  const mutated = state.apply(state.tr.setNodeAttribute(htmlPos, 'value', '<script>x</script>'))
  mutated.doc.check()
  assert.deepEqual(htmlValues(mutated.doc), [])
  assert.match(mutated.doc.textContent, /<script>x<\/script>/)
  assert.equal(notices.length, 1)

  const fmAdded = mutated.apply(mutated.tr.insert(0, s.nodes.frontmatter.create({ value: 'title: <b>hi</b>' })))
  fmAdded.doc.check()
  assert.equal(fmAdded.doc.firstChild.type.name, 'code_block')
  assert.match(fmAdded.doc.textContent, /title: <b>hi<\/b>/)
  assert.equal(notices.length, 2)
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
