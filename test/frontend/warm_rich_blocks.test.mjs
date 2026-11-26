import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

// The heavy packages are replaced by stubs that record being loaded; a `?n`
// query on an app module gives each test its own fresh module state.
const loads = (globalThis.richBlockLoads = { shiki: 0, excalidraw: 0, canvas: 0, shikiFails: false, sketchFails: false })
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  shiki: stub(`export const createHighlighter = async () => {
    const loads = globalThis.richBlockLoads
    loads.shiki += 1
    // As in a browser: an import that failed once fails for good.
    if (!navigator.onLine) loads.shikiFails = true
    if (loads.shikiFails) throw new Error('remembered failure')
    return {}
  }`),
  '@milkdown/plugin-highlight/shiki': stub(`export const createParser = () => () => ['colored']`),
  '@excalidraw/excalidraw': stub(''),
  './excalidraw_canvas': stub(''),
}
const COUNTED = { '@excalidraw/excalidraw': 'excalidraw', './excalidraw_canvas': 'canvas' }

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (COUNTED[specifier]) {
      loads[COUNTED[specifier]] += 1
      if (!navigator.onLine) loads.sketchFails = true
      if (loads.sketchFails) throw new Error('remembered failure')
    }
    if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
    if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:')) {
      const parent = new URL(context.parentURL)
      const file = `${path.resolve(path.dirname(fileURLToPath(parent)), specifier)}.ts`
      if (existsSync(file)) {
        return { url: pathToFileURL(file).href + parent.search, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !/\.ts(\?|$)/.test(url)) return nextLoad(url, context)
    const source = ts.transpileModule(readFileSync(fileURLToPath(url.split('?')[0]), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return { format: 'module', source, shortCircuit: true }
  },
})

const online = new Set()
const onLoad = new Set()
const idle = new Map()
const idleApi = {
  requestIdleCallback: (callback, options) => {
    idle.set(idle.size + 1, { callback, options })
    return idle.size
  },
  cancelIdleCallback: (id) => idle.delete(id),
}
globalThis.window = {
  addEventListener: (event, handler) =>
    ({ online, load: onLoad })[event]?.add(handler),
  removeEventListener: (event, handler) => ({ online, load: onLoad })[event]?.delete(handler),
  ...idleApi,
}
const connection = { onLine: true }
Object.defineProperty(globalThis, 'navigator', { value: connection, configurable: true })
const reconnect = () => {
  connection.onLine = true
  const handlers = [...online]
  online.clear() // every listener is { once: true }
  handlers.forEach((handler) => handler())
}
globalThis.document = { readyState: 'complete' }
const runIdle = () => idle.forEach(({ callback }) => callback())

let instance = 0
const fresh = async () => {
  instance += 1
  Object.assign(loads, { shiki: 0, excalidraw: 0, canvas: 0, shikiFails: false, sketchFails: false })
  connection.onLine = true
  online.clear()
  onLoad.clear()
  idle.clear()
  document.readyState = 'complete'
  Object.assign(window, idleApi)
  const base = '../../app/frontend/editor'
  return {
    ...(await import(`${base}/warm_rich_blocks.ts?${instance}`)),
    ...(await import(`${base}/highlighter.ts?${instance}`)),
    ...(await import(`${base}/sketch/excalidraw_loader.ts?${instance}`)),
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const code = { content: 'x = 1', language: 'ruby', pos: 0, size: 5 }

test('opening a text document loads neither the highlighter nor the drawing tools', async () => {
  const { warmForContent, lazyShikiParser } = await fresh()
  warmForContent('<h1>Title</h1><p>A <strong>present</strong> for you</p>')
  lazyShikiParser()
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [0, 0, 0])
})

test('a document with code loads only the highlighter', async () => {
  const { warmForContent } = await fresh()
  warmForContent('<p>Intro</p><pre><code>x = 1</code></pre>')
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [1, 0, 0])
})

test('a document with a sketch loads the preview renderer and the canvas', async () => {
  const { warmForContent } = await fresh()
  warmForContent('<figure class="thinkroom-sketch is-editable"></figure>')
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [0, 1, 1])
})

test('warming the highlighter twice loads it once', async () => {
  const { warmHighlighter } = await fresh()
  warmHighlighter()
  warmHighlighter()
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [1, 0, 0])
})

test('the first code block loads the highlighter once and colors when it is ready', async () => {
  const { lazyShikiParser } = await fresh()
  const parse = lazyShikiParser()
  const pending = parse(code)
  assert.ok(pending instanceof Promise)
  assert.equal(parse(code), pending)
  await pending
  assert.equal(loads.shiki, 1)
  assert.deepEqual(parse(code), ['colored'])
})

test('a code block seen offline waits, then colors itself on reconnecting', async () => {
  const { lazyShikiParser } = await fresh()
  const parse = lazyShikiParser()
  connection.onLine = false
  const pending = parse(code)
  assert.equal(parse(code), pending)
  await settle()
  assert.deepEqual([loads.shiki, online.size], [0, 1])
  reconnect()
  await pending
  assert.equal(loads.shiki, 1)
  assert.deepEqual(parse(code), ['colored'])
})

test('a long offline edit leaves one pending refresh per editor', async () => {
  const { lazyShikiParser } = await fresh()
  const refreshes = [0, 0]
  const editors = [lazyShikiParser(), lazyShikiParser()]
  connection.onLine = false
  for (let update = 0; update < 1000; update += 1) {
    editors.forEach((parse, editor) => void parse(code).then(() => (refreshes[editor] += 1)))
    await null
  }
  reconnect()
  await settle()
  assert.deepEqual(refreshes, [1, 1])
})

test('a highlighter load that fails while connected is not tried again', async () => {
  const { lazyShikiParser, warmHighlighter } = await fresh()
  const parse = lazyShikiParser()
  loads.shikiFails = true
  await assert.rejects(parse(code))
  reconnect()
  warmHighlighter()
  await assert.rejects(parse(code))
  assert.deepEqual([loads.shiki, online.size], [1, 0])
})

test('warming offline starts nothing, and works once connected', async () => {
  const { warmForContent } = await fresh()
  const html = '<pre><code>x</code></pre><figure class="thinkroom-sketch"></figure>'
  connection.onLine = false
  warmForContent(html)
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas, online.size], [0, 0, 0, 0])
  reconnect()
  warmForContent(html)
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [1, 1, 1])
})

test('a sketch opened offline waits and loads on reconnecting', async () => {
  const { loadExcalidraw, loadExcalidrawCanvas } = await fresh()
  connection.onLine = false
  const waiting = [loadExcalidraw(), loadExcalidraw(), loadExcalidrawCanvas()]
  await settle()
  assert.deepEqual([loads.excalidraw, loads.canvas, online.size], [0, 0, 1])
  reconnect()
  await Promise.all(waiting)
  assert.deepEqual([loads.excalidraw, loads.canvas], [1, 1])
})

test('a wait survives a connection that drops again before it can load', async () => {
  const { loadExcalidraw } = await fresh()
  connection.onLine = false
  const waiting = loadExcalidraw()
  await settle()
  reconnect()
  connection.onLine = false
  await settle()
  assert.deepEqual([loads.excalidraw, online.size], [0, 1])
  reconnect()
  await waiting
  assert.equal(loads.excalidraw, 1)
})

test('exporting offline fails at once without spoiling a later export', async () => {
  const { loadExcalidrawNow } = await fresh()
  connection.onLine = false
  await assert.rejects(loadExcalidrawNow())
  assert.equal(loads.excalidraw, 0)
  connection.onLine = true
  await loadExcalidrawNow()
  connection.onLine = false
  await loadExcalidrawNow()
  assert.equal(loads.excalidraw, 1)
})

test('drawing tools loaded while connected open offline', async () => {
  const { warmSketchTools, loadExcalidraw, loadExcalidrawCanvas } = await fresh()
  warmSketchTools()
  await settle()
  connection.onLine = false
  await Promise.all([loadExcalidraw(), loadExcalidrawCanvas()])
  assert.deepEqual([loads.excalidraw, loads.canvas, online.size], [1, 1, 0])
})

test('a failed warm-up is not repeated on every edit and does not pin the failure', async () => {
  const { warmSketchTools, loadExcalidraw } = await fresh()
  loads.sketchFails = true
  warmSketchTools()
  await settle()
  warmSketchTools()
  await settle()
  assert.equal(loads.excalidraw, 1)
  await assert.rejects(loadExcalidraw())
  loads.sketchFails = false // a failure the browser does not remember, such as a stylesheet
  await loadExcalidraw()
  assert.equal(loads.excalidraw, 3)
})

test('an idle load that comes due offline waits for the connection', async () => {
  const { warmForEditorsWhenIdle } = await fresh()
  warmForEditorsWhenIdle(true)
  connection.onLine = false
  runIdle()
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas, online.size], [0, 0, 0, 1])
  reconnect()
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [1, 1, 1])
})

test('leaving while an idle load waits for the connection cancels it', async () => {
  const { warmForEditorsWhenIdle } = await fresh()
  const cancel = warmForEditorsWhenIdle(true)
  connection.onLine = false
  runIdle()
  cancel()
  assert.equal(online.size, 0)
  reconnect()
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [0, 0, 0])
})

test('a viewer who may edit loads both libraries once the page is idle, not before', async () => {
  const { warmForEditorsWhenIdle } = await fresh()
  warmForEditorsWhenIdle(true)
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [0, 0, 0])
  assert.ok(idle.get(1).options.timeout > 0)
  runIdle()
  await settle()
  assert.deepEqual([loads.shiki, loads.excalidraw, loads.canvas], [1, 1, 1])
})

test('a viewer who cannot edit schedules nothing', async () => {
  const { warmForEditorsWhenIdle } = await fresh()
  document.readyState = 'interactive'
  warmForEditorsWhenIdle(false)()
  assert.deepEqual([idle.size, onLoad.size], [0, 0])
})

test('idle loading waits for the page to load', async () => {
  const { warmForEditorsWhenIdle } = await fresh()
  document.readyState = 'interactive'
  warmForEditorsWhenIdle(true)
  assert.equal(idle.size, 0)
  onLoad.forEach((handler) => handler())
  assert.equal(idle.size, 1)
})

test('leaving before the page loads or goes idle cancels the load', async () => {
  const { warmForEditorsWhenIdle } = await fresh()
  warmForEditorsWhenIdle(true)()
  assert.equal(idle.size, 0)
  document.readyState = 'interactive'
  warmForEditorsWhenIdle(true)()
  assert.equal(onLoad.size, 0)
})

test('a browser without idle callbacks loads after a delay, and leaving cancels it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { warmForEditorsWhenIdle } = await fresh()
  window.requestIdleCallback = undefined
  warmForEditorsWhenIdle(true)()
  t.mock.timers.tick(60_000)
  assert.equal(loads.canvas, 0)
  warmForEditorsWhenIdle(true)
  t.mock.timers.tick(60_000)
  assert.equal(loads.canvas, 1)
})

test('an idle load that fails is ignored', async () => {
  const { warmForEditorsWhenIdle } = await fresh()
  loads.shikiFails = true
  warmForEditorsWhenIdle(true)
  runIdle()
  await settle() // an unhandled rejection would fail this test
  assert.equal(loads.shiki, 1)
})
