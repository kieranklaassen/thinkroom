import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// A one-hook runtime: state lives in slots, so calling the hook again after a
// change is its next render.
const runtime = { slots: [], cursor: 0, visits: [] }
globalThis.useCommentsRuntime = runtime

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  react: stub(`
    const runtime = globalThis.useCommentsRuntime
    export const useState = (initial) => {
      const slot = runtime.cursor++
      if (!(slot in runtime.slots)) runtime.slots[slot] = initial
      return [runtime.slots[slot], (value) => {
        runtime.slots[slot] = typeof value === 'function' ? value(runtime.slots[slot]) : value
      }]
    }
    export const useRef = (initial) => useState({ current: initial })[0]
    export const useCallback = (callback) => callback
    export const useEffect = () => {}
  `),
  '@inertiajs/react': stub(`
    const { visits } = globalThis.useCommentsRuntime
    const visit = (kind) => (url, data, options) => visits.push({ kind, url, data, options })
    export const router = {
      optimistic: () => ({ post: visit('post'), patch: visit('patch') }),
      reload: (options) => visits.push({ kind: 'reload', options }),
    }
  `),
  '../../editor/comment_anchors': stub('export const findCommentAnchorRange = () => null'),
  '../../editor/collab_positions': stub('export const fromRelativePosition = () => null, toRelativePosition = () => null'),
  '../../lib/highlights': stub('export const domRange = () => null, setHighlight = () => {}, clearHighlight = () => {}'),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('use_comments.ts') && STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { useComments } = await import('../../app/frontend/pages/documents/use_comments.ts')

const COMMENT = { id: 7, author_name: 'Ada', author_kind: 'human', body: 'Saved', anchor_text: null, resolved: false, created_at: '' }

// Only a lost connection is handled; the others reach Inertia's callback when
// showing an answer failed. Anything but false leaves the visit's error uncaught.
const LOST = Object.assign(new Error('Network error'), { code: 'ERR_NETWORK' })
const OTHERS = [new Error('Page failed to render'), Object.assign(new Error('Other'), { code: 'ERR_OTHER' })]

function render() {
  runtime.cursor = 0
  return useComments({
    comments: [COMMENT], canComment: true, slug: 'doc', identityName: 'Ada', viewRef: { current: null },
    effectiveMode: 'comment', isMobile: false, docTick: 0,
  })
}
const lastVisit = (kind) => {
  const visit = runtime.visits.at(-1)
  assert.equal(visit.kind, kind)
  return visit.options
}
function start() {
  runtime.slots = []
  runtime.visits.length = 0
  return render()
}
function post() {
  start().submitComment('My draft', 'quoted')
  return lastVisit('post')
}
function resolve() {
  start().resolveComment(COMMENT)
  return lastVisit('patch')
}
function assertDraftKept() {
  const { failedComment } = render()
  assert.equal(failedComment.body, 'My draft')
  assert.equal(failedComment.anchor, 'quoted')
  assert.equal(failedComment.message, 'Connection lost. This comment may already be saved.')
  assert.equal(failedComment.uncertain, true)
  assert.equal(failedComment.checkedMissing, false)
}

const UNRESOLVED = 'Could not confirm resolution. Check your connection and try Resolve again if the comment is still open.'

function assertPosting(error, swallowed) {
  const options = post()
  assert.equal(options.onNetworkError(error) === false, swallowed)
  options.onFinish()
  assertDraftKept()
}

test('a comment that lost its connection keeps the draft and is handled', () => {
  assertPosting(LOST, true)
})

test('a comment whose answer could not be shown keeps the draft and its own error', () => {
  for (const error of OTHERS) assertPosting(error, false)
})

function assertResolving(error, swallowed) {
  const options = resolve()
  assert.equal(options.onNetworkError(error) === false, swallowed)
  options.onFinish()
  const { commentNotice, resolvingComments } = render()
  assert.equal(commentNotice, UNRESOLVED)
  assert.equal(resolvingComments.size, 0)
  return lastVisit('reload')
}

test('a resolve that lost its connection says so and is handled', () => {
  assertResolving(LOST, true)
})

test('a resolve whose answer could not be shown says so and keeps its own error', () => {
  for (const error of OTHERS) assertResolving(error, false)
})

test('the reload after an unconfirmed resolve hides only a lost connection', () => {
  const reload = assertResolving(LOST, true)
  assert.equal(reload.onNetworkError(LOST), false)
  for (const error of OTHERS) assert.notEqual(reload.onNetworkError(error), false)
  assert.equal(render().commentNotice, UNRESOLVED)
})

test('checking for a saved comment hides only a lost connection and always keeps the draft', () => {
  for (const error of [LOST, ...OTHERS]) {
    const posting = post()
    posting.onNetworkError(LOST)
    posting.onFinish()
    render().checkFailedComment()
    assert.equal(render().checkingComment, true)
    const check = lastVisit('reload')
    assert.equal(check.onNetworkError(error) === false, error === LOST)
    check.onFinish()
    assert.equal(render().checkingComment, false)
    assertDraftKept()
  }
})
