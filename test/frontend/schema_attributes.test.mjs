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
import { initProseMirrorDoc } from 'y-prosemirror'
import * as Y from 'yjs'
import { markdownPresets } from '../../app/frontend/editor/schema_attributes.ts'

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
  runners.push(...markdownPresets.map(run))
  runners.forEach((runner) => void runner?.())
  await ctx.wait(ParserReady)
  return { parse: ctx.get(parserCtx), schema: ctx.get(schemaCtx) }
}

test('markdown lists, tasks and untitled images parse into the document', async () => {
  const { parse } = await buildParser()
  const doc = parse('- plain\n\n1. numbered\n\n- [ ] task\n\n![alt](/image.png)\n')
  // check() validates attributes on every ProseMirror version.
  doc.check()
  const names = []
  doc.descendants((node) => void names.push(node.type.name))
  for (const name of ['bullet_list', 'ordered_list', 'list_item', 'image']) {
    assert.ok(names.includes(name), `${name} is missing from ${names.join(', ')}`)
  }
})

test('an image may have no alt text, but not one that is no text', async () => {
  const { schema: built } = await buildParser()
  const image = (alt) => built.nodes.image.create({ src: '/image.png', alt })
  image(null).check()
  image('A picture').check()
  assert.throws(() => image(5).check(), RangeError)
})

// A shared document as the editor stored it before ProseMirror validated
// attributes on creation: nested bullet, ordered and task lists whose `spread`
// is "true" or "false", titled and untitled images, code and a table.
const STORED_STATE = [
  'AbUBAQAHAQtwcm9zZW1pcnJvcgMHaGVhZGluZwcAAQAGBAABAQ1UcmlwIHBsYW5uaW5nKAABAAJpZAF3ACgAAQAFbGV2ZWwB',
  'fQGHAQADCXBhcmFncmFwaAcAAREGBAABEhdPcGVuaW5nIHBhcmFncmFwaCB3aXRoIIYBKQZzdHJvbmcOeyJtYXJrZXIiOiIq',
  'In2EASoEYm9sZIYBLgZzdHJvbmcEbnVsbIQBLwIsIIYBMQhlbXBoYXNpcw57Im1hcmtlciI6IioifYQBMgZpdGFsaWOGATgI',
  'ZW1waGFzaXMEbnVsbIQBOQIsIIYBOwppbmxpbmVDb2RlAnt9hAE8BGNvZGWGAUAKaW5saW5lQ29kZQRudWxshAFBByBhbmQg',
  'YSCGAUgEbGluazB7ImhyZWYiOiJodHRwczovL2V4YW1wbGUuY29tL3BsYW4iLCJ0aXRsZSI6bnVsbH2EAUkEbGlua4YBTQRs',
  'aW5rBG51bGyEAU4BLocBEQMLYnVsbGV0X2xpc3QHAAFQAwlsaXN0X2l0ZW0HAAFRAwlwYXJhZ3JhcGgHAAFSBgQAAVMMVGln',
  'aHQgYnVsbGV0hwFSAwtidWxsZXRfbGlzdAcAAWADCWxpc3RfaXRlbQcAAWEDCXBhcmFncmFwaAcAAWIGBAABYw1OZXN0ZWQg',
  'YnVsbGV0hwFiAwtidWxsZXRfbGlzdAcAAXEDCWxpc3RfaXRlbQcAAXIDCXBhcmFncmFwaAcAAXMGBAABdA1EZWVwZXIgYnVs',
  'bGV0KAABcgVsYWJlbAF3A+KAoigAAXIIbGlzdFR5cGUBdwZidWxsZXQoAAFyBnNwcmVhZAF3BWZhbHNlKAABcQZzcHJlYWQB',
  'dwVmYWxzZSgAAWEFbGFiZWwBdwPigKIoAAFhCGxpc3RUeXBlAXcGYnVsbGV0KAABYQZzcHJlYWQBdwVmYWxzZSgAAWAGc3By',
  'ZWFkAXcFZmFsc2UoAAFRBWxhYmVsAXcD4oCiKAABUQhsaXN0VHlwZQF3BmJ1bGxldCgAAVEGc3ByZWFkAXcFZmFsc2WHAVED',
  'CWxpc3RfaXRlbQcAAY0BAwlwYXJhZ3JhcGgHAAGOAQYEAAGPAQ1TZWNvbmQgYnVsbGV0KAABjQEFbGFiZWwBdwPigKIoAAGN',
  'AQhsaXN0VHlwZQF3BmJ1bGxldCgAAY0BBnNwcmVhZAF3BWZhbHNlKAABUAZzcHJlYWQBdwVmYWxzZYcBUAMMb3JkZXJlZF9s',
  'aXN0BwABoQEDCWxpc3RfaXRlbQcAAaIBAwlwYXJhZ3JhcGgHAAGjAQYEAAGkAQpGaXJzdCBzdGVwKAABogEFbGFiZWwBdwIx',
  'LigAAaIBCGxpc3RUeXBlAXcHb3JkZXJlZCgAAaIBBnNwcmVhZAF3BWZhbHNlhwGiAQMJbGlzdF9pdGVtBwABsgEDCXBhcmFn',
  'cmFwaAcAAbMBBgQAAbQBHlNlY29uZCBzdGVwIHdpdGggYSBuZXN0ZWQgbGlzdIcBswEDC2J1bGxldF9saXN0BwAB0wEDCWxp',
  'c3RfaXRlbQcAAdQBAwlwYXJhZ3JhcGgHAAHVAQYEAAHWAQxJbm5lciBidWxsZXQoAAHUAQVsYWJlbAF3A+KAoigAAdQBCGxp',
  'c3RUeXBlAXcGYnVsbGV0KAAB1AEGc3ByZWFkAXcFZmFsc2WHAdQBAwlsaXN0X2l0ZW0HAAHmAQMJcGFyYWdyYXBoBwAB5wEG',
  'BAAB6AEST3RoZXIgaW5uZXIgYnVsbGV0KAAB5gEFbGFiZWwBdwPigKIoAAHmAQhsaXN0VHlwZQF3BmJ1bGxldCgAAeYBBnNw',
  'cmVhZAF3BWZhbHNlKAAB0wEGc3ByZWFkAXcFZmFsc2UoAAGyAQVsYWJlbAF3AjIuKAABsgEIbGlzdFR5cGUBdwdvcmRlcmVk',
  'KAABsgEGc3ByZWFkAXcEdHJ1ZSgAAaEBBW9yZGVyAX0BKAABoQEGc3ByZWFkAXcEdHJ1ZYcBoQEDC2J1bGxldF9saXN0BwAB',
  'hAIDCWxpc3RfaXRlbQcAAYUCAwlwYXJhZ3JhcGgHAAGGAgYEAAGHAg1Cb29rIHRoZSByb29tKAABhQIFbGFiZWwBdwPigKIo',
  'AAGFAghsaXN0VHlwZQF3BmJ1bGxldCgAAYUCBnNwcmVhZAF3BWZhbHNlKAABhQIHY2hlY2tlZAF5hwGFAgMJbGlzdF9pdGVt',
  'BwABmQIDCXBhcmFncmFwaAcAAZoCBgQAAZsCD1NlbmQgdGhlIGludml0ZYcBmgIDC2J1bGxldF9saXN0BwABqwIDCWxpc3Rf',
  'aXRlbQcAAawCAwlwYXJhZ3JhcGgHAAGtAgYEAAGuAgtOZXN0ZWQgdGFzaygAAawCBWxhYmVsAXcD4oCiKAABrAIIbGlzdFR5',
  'cGUBdwZidWxsZXQoAAGsAgZzcHJlYWQBdwVmYWxzZSgAAawCB2NoZWNrZWQBeSgAAasCBnNwcmVhZAF3BWZhbHNlKAABmQIF',
  'bGFiZWwBdwPigKIoAAGZAghsaXN0VHlwZQF3BmJ1bGxldCgAAZkCBnNwcmVhZAF3BWZhbHNlKAABmQIHY2hlY2tlZAF4KAAB',
  'hAIGc3ByZWFkAXcFZmFsc2WHAYQCAwlwYXJhZ3JhcGgHAAHEAgMFaW1hZ2UoAAHFAgNzcmMBdwkvaWNvbi5wbmcoAAHFAgNh',
  'bHQBdw5VbnRpdGxlZCBpbWFnZYcBxAIDCXBhcmFncmFwaAcAAcgCAwVpbWFnZSgAAckCA3NyYwF3CS9pY29uLnBuZygAAckC',
  'A2FsdAF3DFRpdGxlZCBpbWFnZSgAAckCBXRpdGxlAXcHQSB0aXRsZYcByAIDCmNvZGVfYmxvY2sHAAHNAgYEAAHOAgxwdXRz',
  'ICJoZWxsbyIoAAHNAghsYW5ndWFnZQF3BHJ1YnmHAc0CAwV0YWJsZQcAAdwCAxB0YWJsZV9oZWFkZXJfcm93BwAB3QIDDHRh',
  'YmxlX2hlYWRlcgcAAd4CAwlwYXJhZ3JhcGgHAAHfAgYEAAHgAgRJdGVtKAAB3gIHY29sc3BhbgF9ASgAAd4CB3Jvd3NwYW4B',
  'fQEoAAHeAglhbGlnbm1lbnQBdwRsZWZ0hwHeAgMMdGFibGVfaGVhZGVyBwAB6AIDCXBhcmFncmFwaAcAAekCBgQAAeoCBENv',
  'c3QoAAHoAgdjb2xzcGFuAX0BKAAB6AIHcm93c3BhbgF9ASgAAegCCWFsaWdubWVudAF3BXJpZ2h0hwHdAgMJdGFibGVfcm93',
  'BwAB8gIDCnRhYmxlX2NlbGwHAAHzAgMJcGFyYWdyYXBoBwAB9AIGBAAB9QIEUm9vbSgAAfMCB2NvbHNwYW4BfQEoAAHzAgdy',
  'b3dzcGFuAX0BKAAB8wIJYWxpZ25tZW50AXcEbGVmdIcB8wIDCnRhYmxlX2NlbGwHAAH9AgMJcGFyYWdyYXBoBwAB/gIGBAAB',
  '/wIDMTIwKAAB/QIHY29sc3BhbgF9ASgAAf0CB3Jvd3NwYW4BfQEoAAH9AglhbGlnbm1lbnQBdwVyaWdodIcB8gIDCXRhYmxl',
  'X3JvdwcAAYYDAwp0YWJsZV9jZWxsBwABhwMDCXBhcmFncmFwaAcAAYgDBgQAAYkDBEZvb2QoAAGHAwdjb2xzcGFuAX0BKAAB',
  'hwMHcm93c3BhbgF9ASgAAYcDCWFsaWdubWVudAF3BGxlZnSHAYcDAwp0YWJsZV9jZWxsBwABkQMDCXBhcmFncmFwaAcAAZID',
  'BgQAAZMDAjgwKAABkQMHY29sc3BhbgF9ASgAAZEDB3Jvd3NwYW4BfQEoAAGRAwlhbGlnbm1lbnQBdwVyaWdodIcB3AIDCXBh',
  'cmFncmFwaAcAAZkDBgQAAZoDEUNsb3NpbmcgcGFyYWdyYXBoAA==',
].join('')

test('loading a stored document leaves the shared type unchanged', async () => {
  const { schema: built } = await buildParser()
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, Buffer.from(STORED_STATE, 'base64'))
  const fragment = ydoc.getXmlFragment('prosemirror')
  const before = fragment.toString()
  assert.match(before, /<bullet_list spread="false">/)
  assert.match(before, /<ordered_list order="1" spread="true">/)

  const { doc } = initProseMirrorDoc(fragment, built)

  assert.equal(fragment.toString(), before, 'loading changed the shared document')
  doc.check()
  const count = {}
  const tasks = []
  doc.descendants((node) => {
    count[node.type.name] = (count[node.type.name] ?? 0) + 1
    if (node.type.name === 'list_item' && node.attrs.checked != null) tasks.push(node.attrs.checked)
  })
  assert.deepEqual(
    [count.bullet_list, count.ordered_list, count.list_item, count.image, count.code_block, count.table],
    [6, 1, 11, 2, 1, 1],
  )
  assert.deepEqual(tasks, [false, true, false])
})
