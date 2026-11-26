import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

// The heavy packages are replaced by stubs that record being loaded; a `?n`
// query on an app module gives each test its own fresh module state.
const loads = (globalThis.richBlockLoads = { shiki: 0, excalidraw: 0, canvas: 0, shikiFails: false })
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  shiki: stub(`export const createHighlighter = async () => {
    globalThis.richBlockLoads.shiki += 1
    if (globalThis.richBlockLoads.shikiFails) throw new Error('offline')
    return {}
  }`),
  '@milkdown/plugin-highlight/shiki': stub(`export const createParser = () => () => ['colored']`),
  '@excalidraw/excalidraw': stub(''),
  './excalidraw_canvas': stub(''),
}
const COUNTED = { '@excalidraw/excalidraw': 'excalidraw', './excalidraw_canvas': 'canvas' }

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (COUNTED[specifier]) loads[COUNTED[specifier]] += 1
    if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
    if (specifier.startsWith('./') && context.parentURL?.startsWith('file:')) {
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
globalThis.window = {
  addEventListener: (event, handler) => event === 'online' && online.add(handler),
}

let instance = 0
const fresh = async () => {
  instance += 1
  Object.assign(loads, { shiki: 0, excalidraw: 0, canvas: 0, shikiFails: false })
  online.clear()
  const base = '../../app/frontend/editor'
  return {
    ...(await import(`${base}/warm_rich_blocks.ts?${instance}`)),
    ...(await import(`${base}/highlighter.ts?${instance}`)),
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

test('a load that failed offline is retried after the connection returns', async () => {
  const { lazyShikiParser } = await fresh()
  const parse = lazyShikiParser()
  loads.shikiFails = true
  await assert.rejects(parse(code))
  await settle()
  parse(code).catch(() => undefined)
  assert.equal(loads.shiki, 1)
  loads.shikiFails = false
  online.forEach((handler) => handler())
  await parse(code)
  assert.equal(loads.shiki, 2)
  assert.deepEqual(parse(code), ['colored'])
})
