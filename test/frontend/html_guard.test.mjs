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
const { hasHtml, htmlGuard, htmlGuardCtx } = await import(
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

test('a document that holds HTML from others is left alone', async () => {
  const { state, parse, notices } = await guarded('Hello\n\n<mark>')
  const next = state.apply(insert(state, parse, '<i>'))
  assert.deepEqual(htmlValues(next.doc), ['<mark>', '<i>'])
  assert.equal(notices.length, 0)
})

test('HTML is told from code and text', async () => {
  const { parse } = await buildEditor()
  assert.equal(hasHtml(parse('a <b>x</b>')), true)
  assert.equal(hasHtml(parse('`<b>` and &lt;b>\n\n    <i>\n')), false)
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

test('attributes and text beside code save without becoming HTML', async () => {
  const { schema: s, serialize, parse } = await buildEditor()
  const para = (...nodes) => s.node('paragraph', null, nodes)
  const code = (text) => s.text(text, [s.marks.inlineCode.create()])
  const block = (text) => s.node('code_block', null, [s.text(text)])
  const title = 't\n\nx <b>hi</b>'
  const cases = [
    [para(s.text('q', [s.marks.strong.create({ marker: '<b>' })]))],
    [para(s.text('q', [s.marks.emphasis.create({ marker: '<b>' })]))],
    [para(s.text('q', [s.marks.link.create({ href: 'a', title })]))],
    [para(s.text('q', [s.marks.link.create({ href: '<b>(' })]), s.text('['))],
    [para(s.node('image', { src: 'a', alt: 'x', title }))],
    [para(s.node('footnote_reference', { label: title }))],
    [para(s.node('footnote_reference', { label: 'a`' }), code('<b>'))],
    [s.node('footnote_definition', { label: title }, [para(s.text('note'))])],
    [para(s.text('press the ` key or '), code('<b>'))],
    [para(s.text('``` ')), block('<b>')],
    [para(s.text('~~~ ')), block('~~~\n<b>')],
  ]
  for (const nodes of cases) {
    const saved = serialize(s.node('doc', null, nodes))
    assert.deepEqual(htmlValues(parse(saved)), [], saved)
  }
  const kept = serialize(s.node('doc', null, [para(s.text('q', [s.marks.strong.create({ marker: '_' })]))]))
  assert.equal(kept, '__q__\n')
})
