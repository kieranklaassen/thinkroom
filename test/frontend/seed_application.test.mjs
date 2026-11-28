import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  yjs: stub(''),
  '@milkdown/kit/core': stub('export const editorViewCtx = "view"'),
  '@milkdown/plugin-collab': stub('export const collabServiceCtx = "service"'),
  './document_format': stub('export const htmlDefaultValue = (source, trust) => ({ source, trust })'),
  './provenance': stub('export const SKIP_PROVENANCE = "skip-provenance"'),
  './snapshots': stub(`
    export const buildSnapshotPayload = (ctx, ydoc, format) =>
      ({ text: ctx.get('view').state.doc.toString(), ydoc, format })
  `),
}
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    STUBS[specifier] ? { url: STUBS[specifier], shortCircuit: true } : nextResolve(specifier, context),
})

const { connectWithSeed } = await import('../../app/frontend/editor/seed_application.ts')

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: { group: 'block', content: 'text*', marks: '' },
    text: {},
  },
  marks: { provenance: { attrs: { kind: {}, author: {}, state: {} } } },
})
const human = schema.marks.provenance.create({ kind: 'human', author: 'Ada', state: 'approved' })
const seeded = schema.node('doc', null, [
  schema.node('paragraph', null, [schema.text('New. '), schema.text('Kept.', [human])]),
  schema.node('code_block', null, [schema.text('x = 1')]),
])

// As with the real binding, the document reaches the view only on connect.
function connect(seed, { doc = seeded, format = 'markdown' } = {}) {
  const events = []
  const provider = {
    seedContent: null, seedFormat: 'markdown', seedClaim: 'claim', seedAuthorKind: null, seedAuthorName: null, ...seed,
    persistCurrentState: (payload) => events.push(['persist', payload]),
  }
  const oneShot = () => [provider.seedContent, provider.seedAuthorKind, provider.seedAuthorName]
  const view = {
    state: EditorState.create({ schema }),
    dispatch(tr) {
      events.push(['dispatch', tr.getMeta('skip-provenance'), tr.getMeta('addToHistory')])
      view.state = view.state.apply(tr)
    },
  }
  const service = {
    applyTemplate: (template) => events.push(['apply', template, oneShot()]),
    connect: () => {
      view.state = EditorState.create({ doc })
      events.push(['connect', oneShot()])
    },
  }
  const ctx = { get: (token) => ({ view, service })[token] }
  connectWithSeed(ctx, 'ydoc', provider, format, (shown) => {
    assert.equal(shown, view)
    events.push(['attributed', view.state.doc.toString()])
  })
  return { events, view, provider }
}
const consumed = [null, null, null]
const names = (events) => events.map(([name]) => name)

test('an agent\'s seed is consumed, applied, connected, attributed, reported, then persisted', () => {
  const { events, provider, view } = connect(
    { seedContent: '# Seed', seedAuthorKind: 'agent', seedAuthorName: 'Scout' }, { format: 'html' },
  )
  const attributed = view.state.doc.toString()
  assert.deepEqual(events, [
    ['apply', '# Seed', consumed],
    ['connect', consumed],
    ['dispatch', true, false],
    ['attributed', attributed],
    ['persist', { text: attributed, ydoc: 'ydoc', format: 'html' }],
  ])
  // Held until the server is known to store the seed.
  assert.equal(provider.seedClaim, 'claim')
})

test('attribution marks only unmarked text that can carry the mark', () => {
  const { view } = connect({ seedContent: 'seed', seedAuthorKind: 'agent' })
  const text = []
  view.state.doc.descendants((node) => {
    if (node.isText) text.push([node.text, ...node.marks.map((mark) => mark.attrs)])
  })
  assert.deepEqual(text.map(([content, attrs]) => [content, attrs && { ...attrs }]), [
    ['New. ', { kind: 'ai', author: '', state: 'pending' }],
    ['Kept.', { kind: 'human', author: 'Ada', state: 'approved' }],
    ['x = 1', undefined],
  ])
})

test('with nothing to attribute, the document is not touched', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('Kept.', [human])]),
    schema.node('code_block', null, [schema.text('x = 1')]),
  ])
  const { events } = connect({ seedContent: 'seed', seedAuthorKind: 'agent' }, { doc })
  assert.deepEqual(names(events), ['apply', 'connect', 'attributed', 'persist'])
})

test('a seed by a person or by nobody known is persisted without attribution', () => {
  for (const seedAuthorKind of ['human', null]) {
    const { events } = connect({ seedContent: 'seed', seedAuthorKind })
    assert.deepEqual(names(events), ['apply', 'connect', 'persist'])
  }
})

test('an HTML seed is applied as untrusted HTML', () => {
  const { events } = connect({ seedContent: '<p>seed</p>', seedFormat: 'html' })
  assert.deepEqual(events[0], ['apply', { source: '<p>seed</p>', trust: 'external' }, consumed])
})

test('without a seed the document only connects, and leftover authors are dropped', () => {
  const { events } = connect({ seedAuthorKind: 'agent', seedAuthorName: 'Scout' })
  assert.deepEqual(events, [['connect', consumed]])
})
