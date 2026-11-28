import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  './document_title': new URL('../../app/frontend/editor/document_title.ts', import.meta.url).href,
  './provenance': stub('export const collectSpans = (doc, options) => [doc.name, options]'),
}
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    STUBS[specifier] ? { url: STUBS[specifier], shortCircuit: true } : nextResolve(specifier, context),
})

const { createChangeReporter } = await import('../../app/frontend/editor/change_reporting.ts')

const frames = new Map()
let nextFrame = 1
globalThis.requestAnimationFrame = (run) => {
  frames.set(nextFrame, run)
  return nextFrame++
}
globalThis.cancelAnimationFrame = (id) => frames.delete(id)
const runFrames = () => {
  const due = [...frames.values()]
  frames.clear()
  due.forEach((run) => run())
}

function start() {
  frames.clear()
  const calls = []
  const callbacks = (label) => ({
    onSpans: (spans) => calls.push([label, 'spans', ...spans]),
    onSelection: (view, cause) => calls.push([label, 'selection', cause]),
    onTitleChange: (title) => calls.push([label, 'title', title]),
  })
  let current = callbacks('old')
  return {
    calls,
    reporter: createChangeReporter(() => current),
    rerender: (next = callbacks('new')) => { current = next },
  }
}
const viewOf = (name) => ({ state: { doc: { name } } })
const visible = { excludePendingInsertions: true }
const headed = (text, level = 1) => ({
  descendants: (visit) => visit({ type: { name: 'heading' }, attrs: { level }, textContent: text }),
})

test('spans leave out pending insertions', () => {
  const { calls, reporter } = start()
  reporter.reportSpans(viewOf('doc'))
  assert.deepEqual(calls, [['old', 'spans', 'doc', visible]])
})

test('document changes in one frame report spans once, with that frame\'s document', () => {
  const { calls, reporter, rerender } = start()
  const view = viewOf('first')
  reporter.reportSelection(view, 'document')
  view.state = viewOf('latest').state
  reporter.reportSelection(view, 'document')
  assert.deepEqual(calls, [['old', 'selection', 'document'], ['old', 'selection', 'document']])
  assert.equal(frames.size, 1)

  calls.length = 0
  rerender()
  runFrames()
  assert.deepEqual(calls, [['new', 'spans', 'latest', visible]])

  reporter.reportSelection(view, 'document')
  assert.equal(frames.size, 1)
})

test('a selection change reports no spans', () => {
  const { calls, reporter } = start()
  reporter.reportSelection(viewOf('doc'), 'selection')
  assert.equal(frames.size, 0)
  assert.deepEqual(calls, [['old', 'selection', 'selection']])
})

test('cancelling drops the scheduled spans', () => {
  const { calls, reporter } = start()
  reporter.cancelPending()
  reporter.reportSelection(viewOf('doc'), 'document')
  calls.length = 0
  reporter.cancelPending()
  runFrames()
  assert.deepEqual(calls, [])
})

test('only a written title is reported', () => {
  const { calls, reporter, rerender } = start()
  reporter.reportTitle(headed(' '))
  reporter.reportTitle(headed('Section', 2))
  rerender()
  reporter.reportTitle(headed('Plan  B'))
  assert.deepEqual(calls, [['new', 'title', 'Plan B']])
})

test('callbacks are optional', () => {
  const { reporter, rerender } = start()
  rerender({})
  reporter.reportSpans(viewOf('doc'))
  reporter.reportTitle(headed('Title'))
  reporter.reportSelection(viewOf('doc'), 'document')
  runFrames()
})
