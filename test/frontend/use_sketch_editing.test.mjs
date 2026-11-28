import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

// A one-hook runtime: calling the hook again is its next render.
const runtime = (globalThis.sketchEditing = { draft: undefined, effect: null, session: null, wrote: true, writes: [] })

const stub = (source) => `data:text/javascript,${encodeURIComponent(`const runtime = globalThis.sketchEditing\n${source}`)}`
const STUBS = {
  react: stub(`
    export const useState = () => [runtime.draft, (next) => {
      runtime.draft = typeof next === 'function' ? next(runtime.draft) : next
    }]
    export const useEffect = (run, deps) => { runtime.effect = { run, deps } }
  `),
  'react/jsx-runtime': stub('export const jsx = (type, props) => ({ type, props })'),
  'react-dom': stub('export const createPortal = (element, mount) => ({ element, mount })'),
  '@milkdown/kit/core': stub('export const editorViewCtx = "view"'),
  '../collab_session': stub('export const getSession = (slug) => slug === "doc" ? runtime.session : undefined'),
  '../snapshots': stub('export const buildSnapshotPayload = (ctx, ydoc, format) => ({ ydoc, format })'),
  './doc_ops': stub(`
    export const upsertSketchNode = (view, data, activate) => {
      runtime.writes.push(['upsert', view, data, activate])
      return runtime.wrote
    }
    export const deleteSketchNode = (view, id) => {
      runtime.writes.push(['delete', view, id])
      return runtime.wrote
    }
    export const focusAfterSketchNode = (view, id) => { runtime.writes.push(['focus', view, id]) }
  `),
  './sketch_inline': stub('export const InlineSketch = "inline-sketch"'),
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
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const source = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    return { format: 'module', source, shortCircuit: true }
  },
})

const { useSketchEditing } = await import('../../app/frontend/editor/sketch/use_sketch_editing.tsx')
const { DEFAULT_SKETCH_HEIGHT, EMPTY_SKETCH_SCENE } = await import('../../app/frontend/editor/sketch/scene.ts')

function start({ editor = { action: (run) => run({ get: (token) => token }) }, ...options } = {}) {
  const saved = []
  Object.assign(runtime, {
    draft: undefined,
    wrote: true,
    writes: [],
    session: { ydoc: 'ydoc', provider: { persistCurrentState: (payload) => saved.push(payload) } },
  })
  const editableRef = { current: true }
  const suggestingRef = { current: false }
  const controlsRef = { current: null }
  const render = () => useSketchEditing({
    slug: 'doc', contentFormat: 'html', get: () => editor, controlsRef, editableRef, suggestingRef, ...options,
  })
  render()
  return { saved, editableRef, suggestingRef, render, controls: controlsRef.current, controlsRef }
}
const sketch = (id, description = '') => ({ id, description })
const classes = () => {
  const list = new Set()
  return { classList: { add: (name) => list.add(name), remove: (name) => list.delete(name) }, list }
}
const open = (controls, data, { isConnected = true, wrapper = classes() } = {}) => {
  controls.edit(data, { isConnected }, wrapper)
  return wrapper
}
const durable = [{ ydoc: 'ydoc', format: 'html' }]

test('a saved sketch is written and made durable at once', () => {
  const { controls, saved } = start()
  controls.save(sketch('a'))
  assert.deepEqual(runtime.writes, [['upsert', 'view', sketch('a'), false]])
  assert.deepEqual(saved, durable)
})

test('an inserted sketch is empty, its own, and opened', () => {
  const { controls, saved } = start()
  controls.insert()
  controls.insert()
  const [[, , first, activate], [, , second]] = runtime.writes
  assert.deepEqual(
    { ...first, id: '' },
    { id: '', formatVersion: 1, description: '', height: DEFAULT_SKETCH_HEIGHT, scene: EMPTY_SKETCH_SCENE },
  )
  assert.equal(activate, true)
  assert.notEqual(first.id, second.id)
  assert.notEqual(first.scene.elements, EMPTY_SKETCH_SCENE.elements)
  assert.notEqual(first.scene.elements, second.scene.elements)
  assert.equal(saved.length, 2)
})

test('a deleted sketch is removed, made durable and closed', () => {
  const { controls, saved } = start()
  open(controls, sketch('a'))
  controls.delete('a')
  assert.deepEqual(runtime.writes, [['delete', 'view', 'a']])
  assert.deepEqual(saved, durable)
  assert.equal(runtime.draft, undefined)
})

test('a write that changed nothing, or with no session, persists nothing', () => {
  const { controls, saved } = start()
  runtime.wrote = false
  controls.save(sketch('a'))
  controls.delete('a')
  assert.deepEqual(saved, [])

  const other = start({ slug: 'elsewhere' })
  other.controls.save(sketch('a'))
  assert.equal(runtime.writes.length, 1)
  assert.deepEqual(other.saved, [])
})

const READ_ONLY = [['reading', 'editableRef', false], ['suggesting', 'suggestingRef', true]]
for (const [mode, ref, value] of READ_ONLY) test(`nothing is written while ${mode}, checked when a control is used`, () => {
  const { controls, saved, [ref]: live } = start()
  open(controls, sketch('a'))
  assert.equal(controls.enabled(), true)
  live.current = value
  assert.equal(controls.enabled(), false)
  controls.insert()
  controls.delete('a')
  controls.save(sketch('a', 'later'))
  assert.deepEqual([runtime.writes, saved], [[], []])
  assert.deepEqual(runtime.draft.data, sketch('a', 'later'))
})

test('nothing is written before there is an editor', () => {
  const { controls } = start({ editor: null })
  open(controls, sketch('a'))
  controls.insert()
  controls.delete('a')
  assert.deepEqual(runtime.writes, [])
  assert.deepEqual(runtime.draft.data, sketch('a'))
})

test('saving and closing one sketch leaves another one\'s open editor alone', () => {
  const { controls } = start()
  open(controls, sketch('a'))
  controls.save(sketch('b', 'other'))
  controls.close('b')
  assert.deepEqual(runtime.draft.data, sketch('a'))
  controls.save(sketch('a', 'new'))
  assert.deepEqual(runtime.draft.data, sketch('a', 'new'))
  controls.close('a')
  assert.equal(runtime.draft, undefined)
})

test('the open editor is drawn in its mount while that is in the page', () => {
  const { controls, render } = start()
  assert.ok(!render())
  open(controls, sketch('a'), { isConnected: false })
  assert.ok(!render())
  const wrapper = open(controls, sketch('a'))
  const portal = render()
  assert.equal(portal.mount, runtime.draft.mount)
  assert.equal(portal.element.type, 'inline-sketch')
  assert.deepEqual([portal.element.props.data, portal.element.props.wrapper], [sketch('a'), wrapper])
})

test('the inline editor writes without redrawing its own draft, and deletes', () => {
  const { controls, render, saved } = start()
  open(controls, sketch('a'))
  const { onChange, onDelete } = render().element.props
  onChange(sketch('a', 'drawn'))
  assert.deepEqual(runtime.writes, [['upsert', 'view', sketch('a', 'drawn'), false]])
  assert.deepEqual(runtime.draft.data, sketch('a'))
  onDelete('a')
  assert.equal(saved.length, 2)
  assert.equal(runtime.draft, undefined)
})

test('finishing closes the editor and moves the caret only when asked', () => {
  const { controls, render } = start()
  open(controls, sketch('a'))
  render().element.props.onDone()
  assert.equal(runtime.draft, undefined)
  assert.deepEqual(runtime.writes, [])
  open(controls, sketch('a'))
  render().element.props.onDone(true)
  assert.equal(runtime.draft, undefined)
  assert.deepEqual(runtime.writes, [['focus', 'view', 'a']])
})

test('the wrapper is marked while its sketch is being edited', () => {
  const { controls, render } = start()
  assert.equal(runtime.effect.run(), undefined)
  const wrapper = open(controls, sketch('a'))
  render()
  assert.deepEqual(runtime.effect.deps, [runtime.draft])
  const unmark = runtime.effect.run()
  assert.deepEqual([...wrapper.list], ['is-editing'])
  unmark()
  assert.deepEqual([...wrapper.list], [])
})

test('the controls are the latest render\'s', () => {
  const { controlsRef, saved } = start({ slug: 'elsewhere' })
  useSketchEditing({
    slug: 'doc', contentFormat: 'html', get: () => ({ action: (run) => run({ get: (token) => token }) }),
    controlsRef, editableRef: { current: true }, suggestingRef: { current: false },
  })
  controlsRef.current.save(sketch('a'))
  assert.deepEqual(saved, durable)
})
