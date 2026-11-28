import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// A one-hook runtime: state lives in slots, so calling the hook again after a
// change is its next render. Effects wait for `runEffects`; the browser checks
// cover focus after an unpin and the phone scroll.
const runtime = { slots: [], cursor: 0, effects: [], visits: [] }
globalThis.documentsIndexRuntime = runtime

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  react: stub(`
    const runtime = globalThis.documentsIndexRuntime
    export const useState = (initial) => {
      const slot = runtime.cursor++
      if (!(slot in runtime.slots)) runtime.slots[slot] = typeof initial === 'function' ? initial() : initial
      return [runtime.slots[slot], (value) => {
        runtime.slots[slot] = typeof value === 'function' ? value(runtime.slots[slot]) : value
      }]
    }
    export const useRef = (initial) => useState({ current: initial })[0]
    export const useCallback = (callback) => callback
    export const useEffect = (effect) => { runtime.effects.push(effect) }
    export const useLayoutEffect = useEffect
  `),
  '@inertiajs/react': stub(`
    const { visits } = globalThis.documentsIndexRuntime
    const record = (kind) => (url, data, options) => visits.push({ kind, url, data, options })
    const router = {
      delete: (url, options) => visits.push({ kind: 'delete', url, options }),
      patch: record('patch'),
      post: record('post'),
      reload: (options) => visits.push({ kind: 'reload', options }),
      optimistic: () => router,
    }
    export { router }
  `),
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

const pages = '../../app/frontend/pages/documents'
const { useAgentPrompt } = await import(`${pages}/use_agent_prompt.ts`)
const { useContentsFilters } = await import(`${pages}/use_contents_filters.ts`)
const { useDocumentActions } = await import(`${pages}/use_document_actions.ts`)
const { usePinnedList } = await import(`${pages}/use_pinned_list.ts`)

function start(hook, ...args) {
  runtime.slots = []
  runtime.visits.length = 0
  return () => {
    runtime.cursor = 0
    runtime.effects = []
    return hook(...args)
  }
}
const runEffects = () => runtime.effects.forEach((effect) => effect())
const lastVisit = () => runtime.visits.at(-1)

const doc = (slug, { title = slug, tags = [], age_group = 'this_week' } = {}) => ({ slug, title, tags, age_group })
const slugs = (documents) => documents.map(({ slug }) => slug)
const LISTS = ['pinned', 'yours', 'yours_count', 'archived_count', 'recent', 'continue_reading', 'errors']

test('tags that differ only in case are one filter, which finds every page with the tag', () => {
  const render = start(useContentsFilters, [doc('a', { tags: ['Research'] }), doc('b', { tags: ['research', 'Plan'] }), doc('c')])

  assert.deepEqual(render().availableTags, ['Research', 'Plan'])
  render().setSelectedTag('Research')
  assert.deepEqual(slugs(render().visibleDocuments), ['a', 'b'])
})

test('search matches titles and tags in any case and narrows within the chosen tag', () => {
  const render = start(useContentsFilters, [
    doc('a', { title: 'Road Map', tags: ['Work'] }), doc('b', { title: 'Notes', tags: ['Roadside'] }), doc('c', { title: 'Other', tags: ['Work'] }),
  ])

  render().setQuery('  ROAD ')
  assert.deepEqual(slugs(render().visibleDocuments), ['a', 'b'])
  render().setSelectedTag('Work')
  assert.deepEqual(slugs(render().visibleDocuments), ['a'])
  render().clearFilters()
  const { visibleDocuments, filterActive, query } = render()
  assert.deepEqual([slugs(visibleDocuments), filterActive, query], [['a', 'b', 'c'], false, ''])
})

test('a chosen tag that no page has any more stops filtering', () => {
  const render = start(useContentsFilters, [doc('a', { tags: ['Kept'] }), doc('b')])

  render().setSelectedTag('Gone')
  const { activeTag, filterActive, visibleDocuments } = render()
  assert.deepEqual([activeTag, filterActive, slugs(visibleDocuments)], [null, false, ['a', 'b']])
})

test('earlier pages past the first eight wait for the reveal, unless a filter is on', () => {
  const earlier = Array.from({ length: 10 }, (_, i) => doc(`old-${i}`, { age_group: 'earlier' }))
  const counts = ({ thisWeek, visibleEarlier, hiddenEarlierCount }) => [thisWeek.length, visibleEarlier.length, hiddenEarlierCount]
  const render = start(useContentsFilters, [doc('new'), ...earlier])

  assert.deepEqual(counts(render()), [1, 8, 2])
  render().setQuery('old')
  assert.deepEqual(counts(render()), [0, 10, 0])
  render().setQuery('')
  render().setShowAllEarlier(true)
  assert.deepEqual(counts(render()), [1, 10, 0])
})

test('text typed before the page script runs is taken up as the search', () => {
  const render = start(useContentsFilters, [doc('a'), doc('b')])

  render().searchRef.current = { value: 'b' }
  runEffects()
  assert.deepEqual([render().query, slugs(render().visibleDocuments)], ['b', ['b']])
})

test('a page is deleted only after confirming, and a failure is shown and closes swiped rows', (t) => {
  t.after(() => delete globalThis.window)
  let confirmed = false
  globalThis.window = { confirm: () => confirmed }
  const render = start(useDocumentActions)

  render().deleteDocument('a')
  assert.deepEqual(runtime.visits, [])

  confirmed = true
  render().deleteDocument('a')
  const { kind, url, options } = lastVisit()
  assert.deepEqual([kind, url, options.preserveScroll], ['delete', '/d/a', true])
  options.onStart()
  assert.equal(render().deletingSlug, 'a')
  options.onFinish()
  assert.equal(render().deletingSlug, null)

  options.onError({ document: 'Not yours' })
  assert.deepEqual([render().deleteError, render().swipeCloseSignal], ['Not yours', 1])
  options.onError({})
  assert.deepEqual([render().deleteError, render().swipeCloseSignal], ['Delete failed — please try again', 2])
  render().deleteDocument('a')
  assert.equal(render().deleteError, null)
})

test('a delete reloads the archived list only while it is open', (t) => {
  t.after(() => delete globalThis.window)
  globalThis.window = { confirm: () => true }
  const render = start(useDocumentActions)

  render().deleteDocument('a')
  lastVisit().options.onSuccess()
  assert.equal(lastVisit().kind, 'delete')

  render().toggleArchived()
  assert.deepEqual(lastVisit(), { kind: 'reload', options: { only: ['archived'] } })
  render().deleteDocument('a')
  lastVisit().options.onSuccess()
  assert.deepEqual(lastVisit(), { kind: 'reload', options: { only: ['archived', 'archived_count'] } })

  const before = runtime.visits.length
  render().toggleArchived()
  assert.deepEqual([render().showArchived, runtime.visits.length], [false, before])
})

test('archiving reloads the lists and offers an undo that restores the page', () => {
  const render = start(useDocumentActions)
  const page = doc('a', { title: 'Plan' })

  render().setArchived(page, true)
  const archive = lastVisit()
  assert.deepEqual([archive.kind, archive.url, archive.data], ['patch', '/d/a/archive', { archived: true }])
  assert.deepEqual([archive.options.only, archive.options.preserveScroll], [LISTS, true])
  archive.options.onSuccess()
  const { notice } = render()
  assert.equal(notice.text, 'Archived “Plan”.')

  notice.undo()
  assert.deepEqual([lastVisit().url, lastVisit().data], ['/d/a/archive', { archived: false }])
  lastVisit().options.onSuccess()
  assert.deepEqual(render().notice, { text: 'Restored “Plan”.' })

  render().toggleArchived()
  render().setArchived(page, false)
  assert.deepEqual(lastVisit().options.only, [...LISTS, 'archived'])
  lastVisit().options.onError({ archive: 'Not yours' })
  assert.equal(render().deleteError, 'Not yours')
  lastVisit().options.onError({})
  assert.equal(render().deleteError, 'Archive failed — please try again')
  render().setArchived(page, false)
  assert.equal(render().deleteError, null)
})

test('pinning and unpinning are announced, but not a repeat while the first is on its way', () => {
  const render = start(usePinnedList, [doc('a', { title: 'Plan' })])
  assert.deepEqual([...render().pinnedSlugs], ['a'])

  render().setPin(doc('b', { title: 'Notes' }), false)
  assert.deepEqual([lastVisit().kind, lastVisit().url, lastVisit().options.only], ['post', '/d/b/pin', LISTS])
  assert.equal(render().announcement, 'Pinned Notes')

  render().unpinFromPinned(doc('a', { title: 'Plan' }), 0)
  assert.deepEqual([lastVisit().kind, lastVisit().url], ['delete', '/d/a/pin'])
  assert.equal(render().announcement, 'Unpinned Plan')

  const before = runtime.visits.length
  render().setPin(doc('b', { title: 'Notes' }), true)
  assert.deepEqual([render().announcement, runtime.visits.length], ['Unpinned Plan', before])
})

test('a copied agent prompt says so for a moment; a refused copy reveals the text', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let writeText = async () => {}
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  t.after(() => Object.defineProperty(globalThis, 'navigator', original))
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { clipboard: { writeText: (text) => writeText(text) } },
  })
  const render = start(useAgentPrompt)
  t.after(() => delete globalThis.window)
  globalThis.window = { location: { origin: 'https://example.test' } }
  render()
  runEffects()
  const settle = () => new Promise((resolve) => setImmediate(resolve))

  let copied
  writeText = async (text) => { copied = text }
  render().copyInstruction()
  await settle()
  assert.match(copied, /POST https:\/\/example\.test\/api\/docs/)
  assert.equal(copied, render().agentInstruction)
  assert.equal(render().copyState, 'copied')
  t.mock.timers.tick(2000)
  render().copyInstruction()
  await settle()
  t.mock.timers.tick(2000)
  assert.equal(render().copyState, 'copied')
  t.mock.timers.tick(400)
  assert.equal(render().copyState, 'idle')

  writeText = () => Promise.reject(new Error('denied'))
  render().copyInstruction()
  await settle()
  assert.equal(render().copyState, 'refused')

  const thrown = start(useAgentPrompt)
  writeText = () => { throw new Error('no clipboard') }
  thrown().copyInstruction()
  assert.equal(thrown().copyState, 'refused')
})
