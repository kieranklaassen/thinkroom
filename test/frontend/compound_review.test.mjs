import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

// Rendering needs neither the editor nor the router; both only serve handlers.
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  '@inertiajs/react': stub('export const router = {}'),
  '@milkdown/kit/core': stub('export const editorViewCtx = {}'),
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
})

const { useCompoundReview } = await import('../../app/frontend/pages/documents/use_compound_review.ts')

const lens = (key, overrides = {}) => ({ key, name: key, color: 1, enabled: true, ...overrides })
const finding = (id, reviewer_key) => ({ id, reviewer_key, scope: 'phrase' })

function render(options) {
  let result
  const Probe = () => {
    result = useCompoundReview({
      slug: 'doc', pass: undefined, reviewers: [], packs: [], active: true, enabled: true,
      canWrite: true, handle: null, identityName: 'Ada', docTick: 0, ...options,
    })
    return null
  }
  renderToString(createElement(Probe))
  return result
}

test('a finding keeps the lens its pass ran with after the pack changes or drops it', () => {
  const { findingCards } = render({
    reviewers: [lens('hook', { name: 'Renamed', color: 5 }), lens('fresh', { color: 3 })],
    pass: { lenses: [lens('hook', { name: 'Hook', color: 2 }), lens('gone', { color: 4 })], findings: [] },
  })
  const seen = [...findingCards.lenses.values()].map(({ key, name, color }) => [key, name, color])
  assert.deepEqual(seen.sort(), [['fresh', 'fresh', 3], ['gone', 'gone', 4], ['hook', 'Hook', 2]])
})

test('only findings of lenses that are available and switched on are counted', () => {
  const { visibleFindingCount } = render({
    reviewers: [lens('on'), lens('off')],
    packs: [{ id: 1, lenses: [lens('on'), lens('off', { enabled: false })] }],
    pass: {
      lenses: [lens('on'), lens('off'), lens('gone')],
      findings: [finding(1, 'on'), finding(2, 'off'), finding(3, 'gone'), finding(4, 'on')],
    },
  })
  assert.equal(visibleFindingCount, 2)
})

test('a pass that is not loaded or never ran has no findings', () => {
  assert.equal(render({ pass: undefined, reviewers: [lens('on')] }).visibleFindingCount, 0)
  assert.equal(render({ pass: null, reviewers: [lens('on')] }).visibleFindingCount, 0)
})
