import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const entry = new URL('../../app/frontend/editor/milkdown_editor.tsx', import.meta.url)
// A one-component runtime: refs live in slots, so rendering again is the next render.
const runtime = (globalThis.milkdownEditor = {})

// What the component imports answers with its own name and is logged when called.
const CUSTOM = {
  useRef: `(initial) => (runtime.refs[runtime.cursor++] ??= { current: initial })`,
  useEffect: `(run, deps) => { runtime.effects.push({ run, deps }) }`,
  useEditor: `(factory) => { runtime.factory ??= factory; return { get: () => runtime.editor, loading: runtime.loading } }`,
  useSketchEditing: `(options) => {
    options.controlsRef.current = runtime.controls
    runtime.sketch = options
    runtime.effects.push('sketch')
    return null
  }`,
  acquireSession: `(...args) => { log('acquireSession'); runtime.acquired = args; return runtime.session }`,
  seedAlreadyApplied: `(...args) => runtime.applied.has(args.join(' '))`,
  markSeedApplied: `(...args) => { log('markSeedApplied'); runtime.applied.add(args.join(' ')) }`,
  connectWithSeed: `(ctx, ydoc, provider) => log('connectWithSeed', provider.seedContent ?? undefined)`,
  createChangeReporter: `(callbacks) => ({
    reportSpans: () => log('reportSpans'), reportTitle: () => log('reportTitle'),
    reportSelection: () => callbacks().onSelection('view', 'document'), cancelPending: () => log('cancelPending'),
  })`,
  createSnapshotScheduler: `(options) => {
    runtime.snapshots = options
    return { schedule: () => log('schedule'), dispose: () => log('dispose') }
  }`,
  bindMermaidHintPersistence: `() => { log('bindMermaidHints'); return () => log('unbindMermaidHints') }`,
}
const stub = (names) => `data:text/javascript,${encodeURIComponent(`
  const runtime = globalThis.milkdownEditor
  const log = (...entry) => { runtime.log.push(entry.filter((part) => part !== undefined).join(' ')) }
  ${names.map((name) => `export const ${name} = Object.assign(${
    CUSTOM[name] ?? `(...args) => { log('${name}'); return ['${name}', ...args] }`
  }, { key: '${name}' })`).join('\n')}
`)}`
const source = readFileSync(entry, 'utf8')
const STUBS = { 'react/jsx-runtime': stub(['jsx', 'jsxs', 'Fragment']) }
for (const statement of ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest).statements) {
  if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue
  const named = statement.importClause?.namedBindings
  STUBS[statement.moduleSpecifier.text] =
    stub(named && ts.isNamedImports(named) ? named.elements.map(({ name }) => name.text) : [])
}
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    context.parentURL === entry.href && STUBS[specifier]
      ? { url: STUBS[specifier], shortCircuit: true }
      : nextResolve(specifier, context),
  load(url, context, nextLoad) {
    if (url !== entry.href) return nextLoad(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})

const { DocumentEditor } = await import(entry.href)

const CALLBACKS = ['onReady', 'onStatus', 'onSelection', 'onStale', 'onAccessChanged', 'onRejected', 'onNotice', 'onUnsavedEdit']

function mount({ synced = true, props = {}, provider: given = {}, applied = new Set() } = {}) {
  const log = []
  const slices = {
    editorViewCtx: {
      state: { doc: 'doc', get tr() { return 'tr' } }, dom: 'dom', dispatch: () => log.push('dispatch'),
    },
    collabServiceCtx: {
      bindDoc: () => { log.push('bindDoc'); return slices.collabServiceCtx },
      setAwareness: () => log.push('setAwareness'),
      disconnect: () => log.push('disconnect'),
    },
    listenerCtx: { updated: (run) => { log.push('listen'); runtime.updated = run } },
  }
  const name = (slice) => slice.key ?? slice
  const ctx = {
    get: (slice) => slices[name(slice)],
    set: (slice, value) => { log.push(`set ${name(slice)}`); slices[name(slice)] = value },
  }
  const provider = {
    synced, discarded: false, unsavedEdit: false, seedContent: null, awareness: 'awareness', ...given,
    handlers: new Map(),
    on: (event, run) => { log.push(`on ${event}`); provider.handlers.set(event, run) },
    off: (event, run) => {
      log.push(`off ${event}`)
      if (provider.handlers.get(event) === run) provider.handlers.delete(event)
    },
  }
  Object.assign(runtime, {
    log, refs: [], loading: false, applied, factory: undefined, controls: 'controls',
    editor: { action: (run) => run(ctx) },
    session: { provider, ydoc: { store: { clients: new Map() } } },
  })
  let current = {
    slug: 'doc', identity: { name: 'Ada' }, contentFormat: 'html', seedVersion: 'v1',
    ...Object.fromEntries(CALLBACKS.map((callback) => [callback, (...args) => log.push(
      [callback, ...args.filter((arg) => typeof arg !== 'object')].join(' '),
    )])),
    ...props,
  }
  const render = (changes = {}) => {
    current = { ...current, ...changes }
    Object.assign(runtime, { cursor: 0, effects: [] })
    // DocumentEditor wraps the component under test in Milkdown's provider.
    const [, , { children }] = DocumentEditor(current)
    const [, component, componentProps] = children
    component(componentProps)
    log.length = 0
    return runtime.effects
  }
  const effects = render()
  const unbind = effects[0].run()
  return { log, slices, provider, effects, unbind, render }
}

const OPENING = ['acquireSession', 'onStatus connecting', 'on stale', 'on access-changed', 'on rejected', 'on unsaved-edit', 'onUnsavedEdit false']
const BINDING = [
  'set readPointerAwarenessCtx', 'bindDoc', 'gatedCursorAwareness', 'setAwareness', 'set taskPersistenceCtx', 'connectWithSeed',
  'set selectionCallbackCtx', 'reportSpans', 'listen', 'reportTitle', 'bindMermaidHints',
  'disableSuggestChanges', 'onReady', 'onStatus live',
]
const CLOSING = [
  'off synced', 'off stale', 'off access-changed', 'off rejected', 'off unsaved-edit',
  'unbindMermaidHints', 'cancelPending', 'dispose', 'disconnect', 'releaseSession',
]

test('a document with content binds at once, in order, and unbinds in order', () => {
  const { log, provider, unbind } = mount()
  assert.deepEqual(log, [...OPENING, ...BINDING])
  log.length = 0
  unbind()
  assert.deepEqual(log, CLOSING)
  assert.equal(provider.handlers.size, 0)
})

test('the bind effect comes first and the sketch editor\'s last', () => {
  const { effects } = mount()
  assert.equal(effects.length, 4)
  assert.equal(effects[3], 'sketch')
  assert.deepEqual(effects.slice(0, 3).map(({ deps }) => deps), [
    [false, 'doc', 'html', true, 'guest'], [true, true, false], [false, false],
  ])
})

test('an ungranted empty document waits for the sync, and not past its cleanup', () => {
  const first = mount({ synced: false })
  assert.deepEqual(first.log, [...OPENING, 'on synced'])
  const synced = first.provider.handlers.get('synced')
  first.log.length = 0
  synced()
  synced()
  assert.deepEqual(first.log, BINDING)

  const closed = mount({ synced: false })
  const late = closed.provider.handlers.get('synced')
  closed.unbind()
  closed.log.length = 0
  late()
  assert.deepEqual(closed.log, [])
})

test('a granted seed is marked, handed to the provider, and applied once per grant', () => {
  const props = { seedGranted: true, seedContent: '# Seed', seedClaim: 'claim', seedAuthorKind: 'agent', seedAuthorName: 'Scout' }
  const { log, provider } = mount({ synced: false, props })
  assert.deepEqual(log.slice(OPENING.length, OPENING.length + 1), ['markSeedApplied'])
  assert.ok(log.includes('connectWithSeed # Seed'))
  const { seedContent, seedClaim, seedFormat, seedAuthorKind, seedAuthorName } = provider
  assert.deepEqual([seedContent, seedClaim, seedFormat, seedAuthorKind, seedAuthorName], ['# Seed', 'claim', 'html', 'agent', 'Scout'])

  const { applied } = runtime
  const again = mount({ synced: false, props, applied })
  assert.deepEqual(again.log, [...OPENING, 'on synced'])
  const nextGrant = mount({ synced: false, props: { ...props, seedClaim: 'other' }, applied })
  assert.ok(nextGrant.log.includes('markSeedApplied'))
})

test('a session discarded while nobody listened reports itself stale', () => {
  const { log } = mount({ provider: { discarded: true, unsavedEdit: true } })
  assert.deepEqual(log.slice(OPENING.length - 1, OPENING.length + 1), ['onUnsavedEdit true', 'onStale'])
})

test('a reader binds without persisting diagram heights', () => {
  const { log, unbind } = mount({ props: { canWrite: false } })
  assert.ok(!log.includes('bindMermaidHints'))
  assert.equal(runtime.snapshots.canWrite(), false)
  log.length = 0
  unbind()
  assert.deepEqual(log, CLOSING.filter((entry) => entry !== 'unbindMermaidHints'))
})

test('events, edits and notices reach the newest callbacks', () => {
  const { log, provider, slices, render } = mount()
  render({ onStale: () => log.push('new stale'), onNotice: (message) => log.push(message) })
  for (const event of ['stale', 'access-changed', 'rejected']) provider.handlers.get(event)()
  slices.selectionCallbackCtx.fn()
  runtime.updated(null, 'doc')
  assert.deepEqual(log, ['new stale', 'onAccessChanged', 'onRejected', 'onSelection view document', 'reportTitle', 'schedule'])
  log.length = 0
  runtime.snapshots.onTooLarge()
  const [, assembly] = runtime.factory('root')
  assembly.onEditRefused()
  assert.match(log[0], /saved copy is stale/)
  assert.match(log.at(-1), /was not applied/)
})

test('the editor is assembled from the first render and reads the mode live', () => {
  const { render, slices } = mount({ props: { renderHints: { mermaid: 'hints' } } })
  const [, assembly] = runtime.factory('root')
  render({ editable: false, suggesting: true, taskInteractive: true, identity: { name: 'Bea' }, renderHints: undefined })
  assert.deepEqual([assembly.root, assembly.authorName, assembly.mermaidHints], ['root', 'Ada', 'hints'])
  assert.equal(assembly.editable(), false)
  assert.equal(assembly.sketchControls(), 'controls')
  assert.equal(slices.taskPersistenceCtx.enabled(), true)
  const { slug, contentFormat, editableRef, suggestingRef } = runtime.sketch
  assert.deepEqual([slug, contentFormat, editableRef.current, suggestingRef.current], ['doc', 'html', false, true])
})

test('Suggest mode reaches the document only once it is bound', () => {
  const waiting = mount({ synced: false, props: { suggesting: true } })
  waiting.log.length = 0
  waiting.effects[2].run()
  assert.deepEqual(waiting.log, [])
  waiting.provider.handlers.get('synced')()
  assert.deepEqual(waiting.log.slice(-3), ['enableSuggestChanges', 'onReady', 'onStatus live'])
  waiting.log.length = 0
  waiting.effects[2].run()
  assert.deepEqual(waiting.log, ['enableSuggestChanges'])
})

test('a mode change makes the view read whether it is editable', () => {
  const { log, effects } = mount()
  log.length = 0
  effects[1].run()
  assert.deepEqual(log, ['dispatch'])
})

test('nothing binds while the editor is loading', () => {
  const { render, log } = mount()
  runtime.loading = true
  const effects = render()
  effects.slice(0, 3).forEach(({ run }) => run())
  assert.deepEqual(log, [])
})
