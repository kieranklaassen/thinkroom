import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Schema } from '@milkdown/kit/prose/model'

// A one-hook runtime: state lives in slots, so calling the hook again after a
// change is its next render. Nothing here depends on an effect or a memo.
const runtime = { slots: [], cursor: 0, visits: [] }
globalThis.writingPassRuntime = runtime

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  react: stub(`
    const runtime = globalThis.writingPassRuntime
    export const useState = (initial) => {
      const slot = runtime.cursor++
      if (!(slot in runtime.slots)) runtime.slots[slot] = initial
      return [runtime.slots[slot], (value) => { runtime.slots[slot] = value }]
    }
    export const useRef = (initial) => useState({ current: initial })[0]
    export const useCallback = (callback) => callback
    export const useMemo = (compute) => compute()
    export const useEffect = () => {}
  `),
  '@inertiajs/react': stub(`
    const { visits } = globalThis.writingPassRuntime
    const visit = (kind) => (url, data, options) => visits.push({ kind, url, data, options })
    export const router = {
      patch: visit('patch'),
      post: visit('post'),
      delete: (url, options) => visits.push({ kind: 'delete', url, options }),
    }
  `),
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

const { useWritingPass } = await import('../../app/frontend/pages/documents/use_writing_pass.ts')
const { paragraphDigest } = await import('../../app/frontend/editor/paragraph_projection.ts')

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    heading: { group: 'block', content: 'text*' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: { group: 'block', content: 'text*' },
    text: {},
  },
})
function handleFor(...blocks) {
  const doc = schema.node('doc', null, blocks.map(([type, text]) => schema.node(type, null, text ? schema.text(text) : [])))
  return { editor: { action: (run) => run({ get: () => ({ state: { doc } }) }) } }
}

const lens = (key, enabled = true) => ({ key, name: key, color: 1, enabled })

function start(options = {}) {
  runtime.slots = []
  runtime.visits.length = 0
  return () => {
    runtime.cursor = 0
    return useWritingPass({
      slug: 'doc', pass: null, reviewers: [lens('hook')], packs: [], active: true, enabled: true,
      canWrite: true, handle: handleFor(['paragraph', 'Some prose.']), identityName: 'Ada', docTick: 0, ...options,
    })
  }
}
const lastVisit = () => runtime.visits.at(-1)

// A short 429 answer is the server's own message; anything else is not for people.
const ANSWERS = [
  [{ status: 429, data: ' Daily limit reached. ' }, 'Daily limit reached.'],
  [{ status: 429, data: '' }, null],
  [{ status: 429, data: 'x'.repeat(240) }, null],
  [{ status: 429, data: { error: 'limit' } }, null],
  [{ status: 500, data: 'Stack trace' }, null],
]

test('a run sends the prose for the available reviewers, once at a time', () => {
  const render = start({
    slug: 'a b', reviewers: [lens('hook'), lens('flow')],
    handle: handleFor(['heading', 'Title'], ['code_block', 'x = 1'], ['paragraph', ''], ['paragraph', 'Some prose.']),
  })

  render().run()
  const { kind, url, data, options } = lastVisit()
  assert.deepEqual([kind, url], ['post', '/d/a%20b/writing_passes'])
  assert.deepEqual(data, {
    reviewers: ['hook', 'flow'],
    paragraphs: [{ index: 0, kind: 'heading', text: 'Title' }, { index: 1, kind: 'paragraph', text: 'Some prose.' }],
    requested_by_name: 'Ada',
  })
  assert.deepEqual([render().requesting, render().canRun], [true, false])

  render().run()
  assert.equal(runtime.visits.length, 1)
  options.onFinish()
  assert.deepEqual([render().requesting, render().canRun], [false, true])
})

test('a run with no prose or no reviewer says why and sends nothing', () => {
  const noProse = start({ handle: handleFor(['code_block', 'x = 1'], ['paragraph', '']) })
  noProse().run()
  assert.equal(noProse().error, 'There is no prose to review yet.')
  assert.deepEqual([noProse().requesting, runtime.visits], [false, []])

  const noReviewer = start({ reviewers: [] })
  noReviewer().run()
  assert.equal(noReviewer().error, 'Switch on at least one reviewer.')
  assert.deepEqual([noReviewer().requesting, runtime.visits], [false, []])
})

test('a run is offered only to a writer whose editor is open and whose server can judge', () => {
  assert.equal(start()().canRun, true)
  for (const missing of [{ enabled: false }, { canWrite: false }, { handle: null }]) {
    assert.equal(start(missing)().canRun, false)
  }
})

test('a refused run shows the reason, and an unchanged text is a notice rather than an error', () => {
  const render = start()
  const refuse = (errors) => {
    render().run()
    const { options } = lastVisit()
    options.onError(errors)
    options.onFinish()
    return [render().error, render().notice]
  }

  assert.deepEqual(refuse({ writing_pass: 'Too long.' }), ['Too long.', null])
  assert.deepEqual(refuse({ writing_pass_notice: 'Nothing changed.' }), [null, 'Nothing changed.'])
  assert.deepEqual(refuse({ document: 'Not yours.' }), ['Not yours.', null])
  assert.deepEqual(refuse({}), ['The reviewers could not start.', null])
  render().clearError()
  assert.equal(render().error, null)
})

test('a run answered without a page shows only a short rate-limit message', () => {
  for (const [response, message] of ANSWERS) {
    const render = start()
    render().run()
    // false keeps the raw answer from opening over the editor.
    assert.equal(lastVisit().options.onHttpException(response), false)
    assert.equal(render().error, message ?? 'The reviewers could not start.')
  }
})

test('switching one reviewer keeps the pack’s other choices', () => {
  const packs = [
    { id: 1, lenses: [lens('other-pack', false)] },
    { id: 2, lenses: [lens('on'), lens('off', false), lens('also-off', false)] },
  ]
  const render = start({ packs })
  assert.deepEqual([...render().off], ['other-pack', 'off', 'also-off'])

  render().toggleLens(2, 'on')
  assert.deepEqual([lastVisit().kind, lastVisit().url], ['patch', '/writing_packs/2'])
  assert.deepEqual(lastVisit().data.disabled_lens_keys.sort(), ['also-off', 'off', 'on'])
  render().toggleLens(2, 'off')
  assert.deepEqual(lastVisit().data.disabled_lens_keys, ['also-off'])

  const sent = runtime.visits.length
  render().toggleLens(3, 'on')
  assert.equal(runtime.visits.length, sent)
})

test('adding a pack needs a name; adding and removing are busy until they finish', () => {
  const render = start()
  render().addPack('   ')
  assert.match(render().packError, /^Enter a marketplace/)
  assert.deepEqual([render().packBusy, runtime.visits], [false, []])

  render().addPack(' owner/repo ')
  assert.deepEqual([lastVisit().kind, lastVisit().url, lastVisit().data], ['post', '/writing_packs', { locator: 'owner/repo' }])
  assert.deepEqual([render().packBusy, render().packError], [true, null])
  lastVisit().options.onFinish()
  assert.equal(render().packBusy, false)

  render().removePack(4)
  assert.deepEqual([lastVisit().kind, lastVisit().url, render().packBusy], ['delete', '/writing_packs/4', true])
  lastVisit().options.onFinish()
  assert.equal(render().packBusy, false)
})

test('a refused pack change shows the reason until the next change', () => {
  const render = start()
  render().addPack('owner/repo')
  lastVisit().options.onError({ writing_pack: 'No such pack.' })
  assert.equal(render().packError, 'No such pack.')
  lastVisit().options.onError({})
  assert.equal(render().packError, 'That pack could not be changed.')
  for (const [response, message] of ANSWERS) {
    assert.equal(lastVisit().options.onHttpException(response), false)
    assert.equal(render().packError, message ?? 'That pack could not be changed.')
  }
  render().removePack(1)
  assert.equal(render().packError, null)
})

test('the text counts as changed only against the prose the pass judged', () => {
  const pass = { paragraphs_digest: paragraphDigest(['Some prose.']) }
  const changed = (options) => start({ pass, ...options })().textChanged

  assert.equal(changed(), false)
  assert.equal(changed({ handle: handleFor(['paragraph', 'Some prose.'], ['code_block', 'new code']) }), false)
  const edited = handleFor(['paragraph', 'Some other prose.'])
  assert.equal(changed({ handle: edited }), true)
  for (const unjudged of [{ active: false }, { pass: null }, { handle: null }]) {
    assert.equal(changed({ handle: edited, ...unjudged }), false)
  }
})
