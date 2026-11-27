import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import * as Y from 'yjs'

// Resolve extensionless relative imports (../lib/cable -> ../lib/cable.ts).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
      const file = path.resolve(path.dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`)
      if (existsSync(file)) return nextResolve(pathToFileURL(file).href, context)
    }
    return nextResolve(specifier, context)
  },
})

// Before the page globals: with a document, the view module expects a whole page.
const { ySyncPlugin } = await import('y-prosemirror')
globalThis.window ??= { addEventListener() {}, removeEventListener() {} }
globalThis.document ??= { querySelector: () => ({ content: 'test-csrf-token' }) }

const { CableProvider, SERVER_HYDRATE_ORIGIN } = await import('../../app/frontend/editor/cable_provider.ts')
const { startDocument } = await import('../../app/frontend/editor/start_document.ts')

const toBase64 = (u8) => Buffer.from(u8).toString('base64')
const fromBase64 = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    blockquote: { group: 'block', content: 'block+' },
    text: {},
  },
})

// The real binding plugin on the least view it needs.
function bindEditor(doc) {
  const plugin = ySyncPlugin(doc.getXmlFragment('prosemirror'))
  const view = {
    state: EditorState.create({ schema, plugins: [plugin] }),
    hasFocus: () => false,
    dispatch(tr) {
      view.state = view.state.apply(tr)
    },
  }
  plugin.spec.view(view)
  return view
}

function append(doc, name, text) {
  const node = new Y.XmlElement(name)
  const content = new Y.XmlText()
  node.insert(0, [content])
  content.insert(0, text)
  const fragment = doc.getXmlFragment('prosemirror')
  fragment.insert(fragment.length, [node])
}

function appendQuotes(doc, levels, text) {
  const paragraph = new Y.XmlElement('paragraph')
  const content = new Y.XmlText()
  content.insert(0, text)
  paragraph.insert(0, [content])
  const fragment = doc.getXmlFragment('prosemirror')
  let parent = fragment
  for (let level = 0; level < levels; level += 1) {
    const quote = new Y.XmlElement('blockquote')
    parent.insert(parent.length, [quote])
    parent = quote
  }
  parent.insert(0, [paragraph])
}

// An edit to a doc whose editor was given up; that editor may still listen.
function appendLate(doc, text) {
  try {
    append(doc, 'paragraph', text)
  } catch {
    // its own answer to the edit, which no page waits for
  }
}

// Every text in the document, read without recursion.
function texts(doc) {
  const found = []
  const open = [doc.getXmlFragment('prosemirror')]
  while (open.length > 0) {
    const node = open.pop()
    if (node instanceof Y.XmlText) found.push(node.toDelta().map((part) => part.insert).join(''))
    else open.push(...node.toArray())
  }
  return found.sort()
}

// A page: the folded state it embeds, and what the server holds beyond it.
function page(t, { sourcePreview, write }) {
  const server = new Y.Doc()
  append(server, 'paragraph', 'kept')
  const folded = Y.encodeStateAsUpdate(server)
  write?.(server)

  const doc = new Y.Doc()
  Y.applyUpdate(doc, folded, SERVER_HYDRATE_ORIGIN)
  const sent = []
  let callbacks = null
  const provider = new CableProvider(doc, 'demo', {
    consumer: {
      subscriptions: {
        create(_params, cbs) {
          callbacks = cbs
          return { send: (frame) => sent.push(frame), unsubscribe() {} }
        },
      },
    },
  })
  t.after(() => provider.destroy())
  const saves = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    saves.push(JSON.parse(init.body))
    return { ok: true, status: 204, json: async () => ({}) }
  }
  t.after(() => {
    globalThis.fetch = realFetch
  })

  const seen = { view: null, opened: 0, ready: 0, unavailable: 0 }
  const stop = startDocument({
    provider,
    hasLocalContent: true,
    sourcePreview,
    takeSeed: () => false,
    open: (bind) => {
      seen.opened += 1
      bind(() => {
        seen.view = bindEditor(doc)
      })
    },
    ready: () => {
      seen.ready += 1
    },
    unavailable: () => {
      seen.unavailable += 1
    },
  })
  const updates = () => sent.filter((frame) => frame.type === 'update' || frame.type === 'sync-reply')
  return {
    doc, provider, server, seen, saves, stop, updates,
    handshake: () => callbacks.received({
      type: 'sync',
      update: toBase64(Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc))),
      sv: toBase64(Y.encodeStateVector(server)),
      generation: 1,
    }),
    peer: (change) => {
      const before = Y.encodeStateVector(server)
      change(server)
      callbacks.received({ type: 'update', update: toBase64(Y.encodeStateAsUpdate(server, before)), cid: 'peer' })
    },
    // What the server would hold after everything this page sent.
    stored: () => {
      const merged = new Y.Doc()
      Y.applyUpdate(merged, Y.encodeStateAsUpdate(server))
      ;[...updates(), ...saves].forEach((frame) => Y.applyUpdate(merged, fromBase64(frame.update)))
      return texts(merged)
    },
  }
}

const unknown = (doc) => append(doc, 'nosuchnode', 'tail')
const deep = (doc) => appendQuotes(doc, 6_000, 'tail')
const ordinary = (doc) => append(doc, 'paragraph', 'tail')

test('a document without a source preview opens on what the page embeds', (t) => {
  const p = page(t, { sourcePreview: false, write: ordinary })
  assert.equal(p.seen.ready, 1)
  assert.equal(p.seen.view.state.doc.textContent, 'kept')
})

test('behind a source preview the editor opens on the handshake, with all of it', (t) => {
  const p = page(t, { sourcePreview: true, write: ordinary })
  assert.equal(p.seen.opened, 0)
  p.handshake()

  assert.deepEqual([p.seen.ready, p.seen.unavailable], [1, 0])
  assert.equal(p.seen.view.state.doc.textContent, 'kepttail')
  assert.equal(p.updates().length, 0)
})

for (const [name, write] of [['a node the schema lacks', unknown], ['nesting it cannot build', deep]]) {
  test(`an unfolded tail with ${name} keeps the preview and the stored text`, (t) => {
    const p = page(t, { sourcePreview: true, write })
    p.handshake()

    assert.deepEqual([p.seen.ready, p.seen.unavailable], [0, 1])
    appendLate(p.doc, 'typed')
    p.provider.persistCurrentState({ content: 'partial', spans: [], state_vector: '' })
    p.provider.destroy()
    assert.equal(p.updates().length, 0)
    assert.deepEqual(p.saves, [])
    assert.deepEqual(p.stored(), ['kept', 'tail'])
  })

  test(`a peer update with ${name} returns to the preview and keeps what was typed`, (t) => {
    const p = page(t, { sourcePreview: true })
    p.handshake()
    append(p.doc, 'paragraph', 'typed')
    assert.equal(p.updates().length, 1)
    append(p.doc, 'paragraph', 'queued')
    p.peer(write)

    assert.deepEqual([p.seen.ready, p.seen.unavailable], [1, 1])
    appendLate(p.doc, 'late')
    p.provider.destroy()
    assert.deepEqual(p.stored(), ['kept', 'queued', 'tail', 'typed'])
  })
}

test('a peer deletion is an ordinary edit', (t) => {
  const p = page(t, { sourcePreview: true, write: ordinary })
  p.handshake()
  p.peer((doc) => doc.getXmlFragment('prosemirror').delete(1, 1))

  assert.deepEqual([p.seen.ready, p.seen.unavailable], [1, 0])
  assert.equal(p.seen.view.state.doc.textContent, 'kept')
})

test('a stopped start opens nothing and reports nothing', (t) => {
  const p = page(t, { sourcePreview: true, write: unknown })
  p.stop()
  p.handshake()
  assert.deepEqual([p.seen.opened, p.seen.unavailable], [0, 0])
})
