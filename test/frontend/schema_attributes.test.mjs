import assert from 'node:assert/strict'
import test from 'node:test'
import { Clock, Container, Ctx } from '@milkdown/kit/ctx'
import {
  commands,
  config,
  Editor,
  editorState,
  init,
  keymap,
  parser,
  parserCtx,
  ParserReady,
  pasteRule,
  schema,
  schemaCtx,
  serializer,
} from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { initProseMirrorDoc } from 'y-prosemirror'
import * as Y from 'yjs'
import { tolerateMarkdownAttributes } from '../../app/frontend/editor/schema_attributes.ts'

// Milkdown's timers signal each other through window events.
const events = new EventTarget()
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
  globalThis[name] ??= events[name].bind(events)
}

// Run the plugins the editor registers up to the parser; no view, so no DOM.
async function buildParser() {
  const ctx = new Ctx(new Container(), new Clock())
  const editor = Editor.make()
  const run = (plugin) => plugin(ctx)
  const core = [schema, parser, serializer, commands, keymap, pasteRule, editorState]
  const runners = [...core, init(editor), config(async () => {})].map(run)
  runners.push(...[commonmark, gfm, tolerateMarkdownAttributes].flat().map(run))
  runners.forEach((runner) => void runner?.())
  await ctx.wait(ParserReady)
  return { parse: ctx.get(parserCtx), schema: ctx.get(schemaCtx) }
}

test('markdown lists, tasks and untitled images parse into the document', async () => {
  const { parse } = await buildParser()
  const doc = parse('- plain\n\n1. numbered\n\n- [ ] task\n\n![alt](/image.png)\n')
  const names = []
  doc.descendants((node) => void names.push(node.type.name))
  for (const name of ['bullet_list', 'ordered_list', 'list_item', 'image']) {
    assert.ok(names.includes(name), `${name} is missing from ${names.join(', ')}`)
  }
})

test('stored lists whose spread attribute is a string survive loading', async () => {
  const { schema: built } = await buildParser()
  for (const name of ['bullet_list', 'ordered_list']) {
    const ydoc = new Y.Doc()
    const fragment = ydoc.getXmlFragment('prosemirror')
    const list = new Y.XmlElement(name)
    const item = new Y.XmlElement('list_item')
    const paragraph = new Y.XmlElement('paragraph')
    list.setAttribute('spread', 'false')
    item.setAttribute('spread', 'false')
    paragraph.insert(0, [new Y.XmlText('kept')])
    item.insert(0, [paragraph])
    list.insert(0, [item])
    fragment.insert(0, [list])

    const { doc } = initProseMirrorDoc(fragment, built)
    assert.equal(doc.textContent, 'kept')
    assert.equal(fragment.length, 1, `${name} was deleted from the shared document`)
  }
})
