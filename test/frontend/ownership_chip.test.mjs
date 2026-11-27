import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// A one-component hook runtime: state lives in slots, so calling the chip again
// after a click is its next render.
const runtime = { slots: [], cursor: 0, visits: [] }
globalThis.ownershipChipRuntime = runtime

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  react: stub(`
    const runtime = globalThis.ownershipChipRuntime
    export const useState = (initial) => {
      const slot = runtime.cursor++
      if (!(slot in runtime.slots)) runtime.slots[slot] = initial
      return [runtime.slots[slot], (value) => { runtime.slots[slot] = value }]
    }
    export const useRef = (initial) => useState({ current: initial })[0]
  `),
  '@inertiajs/react': stub(`
    export const router = { delete: (url, options) => globalThis.ownershipChipRuntime.visits.push({ url, options }) }
  `),
  '../lib/use_claim': stub('export const useClaim = () => ({ claim() {}, claimFailed: false })'),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('ownership_chip.tsx') && STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})

const { OwnershipChip } = await import('../../app/frontend/components/ownership_chip.tsx')

const YOURS = { claimed: true, claimable: false, yours: true, owner_name: 'Ada' }

function render(ownership = YOURS) {
  runtime.cursor = 0
  return OwnershipChip({ slug: 'doc', ownership, claimerName: 'Ada' })
}

const nodes = (node) => {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== 'object') return []
  return [node, ...nodes(node.props.children)]
}
const text = (node) => {
  if (Array.isArray(node)) return node.map(text).join('')
  if (node && typeof node === 'object') return text(node.props.children)
  return typeof node === 'string' ? node : ''
}
const button = (label) => nodes(render()).find((node) => node.type === 'button' && text(node) === label)
const alert = (tree) => text(nodes(tree).find((node) => node.props.role === 'alert'))

function startDelete() {
  Object.assign(runtime, { slots: [], visits: [] })
  button('Yours — delete…').props.onClick()
  button('Delete?').props.onClick()
  assert.ok(button('Deleting…').props.disabled)
  assert.equal(runtime.visits.length, 1)
  return runtime.visits[0]
}

test('a delete asks an open page for no more than its ownership and activity', () => {
  const { url, options } = startDelete()
  assert.equal(url, '/d/doc')
  assert.deepEqual(options.only, ['ownership', 'activities'])
  assert.equal(options.preserveScroll, 'errors')
})

test('a refused delete says why, whoever owns the document now', () => {
  const { options } = startDelete()
  options.onError({ document: 'Only the owner can delete this document' })
  options.onFinish()
  assert.ok(button('Yours — delete…'))
  for (const ownership of [YOURS, { ...YOURS, yours: false }, { ...YOURS, yours: false, claimed: false, claimable: true }]) {
    assert.equal(alert(render(ownership)), 'Only the owner can delete this document')
  }
})

test('trying again clears the message', () => {
  const { options } = startDelete()
  options.onError({ document: 'Delete failed — please try again' })
  options.onFinish()
  button('Yours — delete…').props.onClick()
  button('Delete?').props.onClick()
  assert.equal(alert(render()), '')
  assert.equal(runtime.visits.length, 2)
})

test('a delete that got no answer can be tried again', () => {
  const { options } = startDelete()
  options.onFinish()
  assert.ok(button('Yours — delete…'))
})
