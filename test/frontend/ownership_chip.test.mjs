import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// A one-component hook runtime: state lives in slots, so calling the chip again
// after a click is its next render. As in React, a change made while rendering
// renders again before anyone sees the result.
const runtime = { slots: [], cursor: 0, visits: [], changed: false }
globalThis.ownershipChipRuntime = runtime

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  react: stub(`
    const runtime = globalThis.ownershipChipRuntime
    export const useState = (initial) => {
      const slot = runtime.cursor++
      if (!(slot in runtime.slots)) runtime.slots[slot] = initial
      return [runtime.slots[slot], (value) => { runtime.slots[slot] = value; runtime.changed = true }]
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
const UNCLAIMED = { ...YOURS, yours: false, claimed: false, claimable: true }

function render(ownership = YOURS) {
  for (let pass = 0; pass < 5; pass++) {
    Object.assign(runtime, { cursor: 0, changed: false })
    const tree = OwnershipChip({ slug: 'doc', ownership, claimerName: 'Ada' })
    if (!runtime.changed) return tree
  }
  throw new Error('the chip keeps changing its state while rendering')
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
  for (const ownership of [YOURS, { ...YOURS, yours: false }, UNCLAIMED]) {
    assert.equal(alert(render(ownership)), 'Only the owner can delete this document')
  }
})

test('trying again clears the message', () => {
  const { options } = startDelete()
  options.onError({ document: 'Delete failed — please try again' })
  options.onFinish()
  button('Yours — delete…').props.onClick()
  button('Delete?').props.onClick()
  assert.equal(runtime.visits.length, 2)
  runtime.visits[1].options.onFinish()
  assert.ok(button('Yours — delete…'))
  assert.equal(alert(render()), '')
})

test('a claim clears the message, wherever it was made', () => {
  const { options } = startDelete()
  render(UNCLAIMED)
  options.onError({ document: 'Only the owner can delete this document' })
  options.onFinish()
  assert.equal(alert(render(UNCLAIMED)), 'Only the owner can delete this document')
  // The claim shows as ownership before its answer arrives; a lost one is undone.
  assert.equal(alert(render(YOURS)), '')
  assert.equal(alert(render({ ...YOURS, yours: false })), '')
})

test('a delete that got no answer says so and can be tried again', () => {
  const { options } = startDelete()
  // Anything but false leaves the failed visit as an uncaught error.
  assert.equal(options.onNetworkError(new Error('Network error')), false)
  options.onFinish()
  assert.ok(button('Yours — delete…'))
  assert.equal(alert(render()), 'Connection lost. This document may already be deleted.')
})
