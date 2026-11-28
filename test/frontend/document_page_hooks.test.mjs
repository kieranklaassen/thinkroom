import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// A one-hook runtime: state lives in slots, so calling the hook again after a
// change is its next render. Effects run after it, when their deps changed.
const runtime = {
  slots: [], cursor: 0, effects: [], visits: [], cookies: [], poll: [], themes: [], highlights: [],
  channel: null, webmcp: null, mobile: false, reviewable: null, span: null, applied: [],
}
globalThis.documentPageRuntime = runtime
runtime.hooks = {
  useState(initial) {
    const slot = runtime.cursor++
    if (!(slot in runtime.slots)) runtime.slots[slot] = initial
    return [runtime.slots[slot], (value) => {
      runtime.slots[slot] = typeof value === 'function' ? value(runtime.slots[slot]) : value
    }]
  },
  useEffect(effect, deps) {
    const slot = runtime.cursor++
    const previous = runtime.slots[slot]
    if (previous && deps.every((dep, index) => Object.is(dep, previous.deps[index]))) return
    const entry = { deps }
    runtime.slots[slot] = entry
    runtime.effects.push(() => {
      previous?.cleanup?.()
      entry.cleanup = effect()
    })
  },
  useMemo(make, deps) {
    const slot = runtime.cursor++
    const previous = runtime.slots[slot]
    if (!previous || !deps.every((dep, index) => Object.is(dep, previous.deps[index]))) {
      runtime.slots[slot] = { deps, value: make() }
    }
    return runtime.slots[slot].value
  },
}

const stub = (source) => `data:text/javascript,${encodeURIComponent(`const r = globalThis.documentPageRuntime\n${source}`)}`
const STUBS = {
  react: stub(`
    export const { useState, useEffect, useMemo } = r.hooks
    export const useRef = (initial) => useState({ current: initial })[0]
    export const useCallback = (callback, deps) => useMemo(() => callback, deps)
  `),
  '@inertiajs/react': stub(`
    const visit = (kind) => (options) => r.visits.push({ kind, options })
    export const router = { push: visit('push'), replace: visit('replace'), visit: visit('visit'), reload: visit('reload') }
    const poll = { start: () => r.poll.push('start'), stop: () => r.poll.push('stop') }
    export const usePoll = (...options) => { r.pollOptions = options; return poll }
  `),
  '@milkdown/kit/core': stub('export const editorViewCtx = {}'),
  '@milkdown/kit/prose/state': stub('export const TextSelection = { create: (_doc, from, to) => ({ from, to }) }'),
  '../../components/mode_control': stub(`export const MODE_SHORTCUTS = { Digit1: 'edit', Digit2: 'suggest', Digit3: 'comment', Digit4: 'read' }`),
  '../../editor/agent_cursors': stub('export const refreshAgentCursors = (_editor, agents) => { r.agents = agents }'),
  '../../editor/provenance': stub(`
    export const provenanceIdentityCtx = { key: 'identity' }
    export const aiSpanAt = () => r.span
    export const bindReviewTarget = (_state, span) => ({ bound: span })
    export const resolveReviewTarget = () => r.reviewable
    export const nextProvenanceRange = () => r.span
    export const applyReviewState = (_view, span, state) => r.applied.push({ span, state })
  `),
  '../../editor/rich_block_width': stub(`export const RICH_BLOCK_WIDTH_EVENT = 'rich-width'`),
  '../../lib/cookies': stub(`
    export const setCookie = (name, value) => r.cookies.push([name, value])
    export const setCookieFlag = setCookie
  `),
  '../../lib/highlights': stub(`
    export const domRange = (_view, from, to) => ({ from, to })
    export const setHighlight = (name, ranges) => r.highlights.push([name, ranges])
    export const clearHighlight = (name) => r.highlights.push([name, null])
  `),
  '../../lib/theme': stub('export const applyTheme = (theme) => r.themes.push(theme)'),
  '../../lib/use_media_query': stub('export const useMediaQuery = () => r.mobile'),
  '../../lib/use_meta_channel': stub('export const useMetaChannel = (slug, options) => { r.channel = { slug, ...options } }'),
  '../../lib/use_webmcp_tools': stub('export const useWebmcpTools = (options) => { r.webmcp = options }'),
  '../../lib/webmcp_execute': stub(`export const executeManifestTool = (tool, args, options) => ({ ran: 'manifest', tool, args, ...options })`),
  '../../lib/webmcp_editor': stub(`export const executeEditorTool = (tool, args, options) => ({ ran: 'editor', tool, args, ...options })`),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/pages/documents/')) {
      if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
      if (specifier.startsWith('.')) return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const load = (name) => import(`../../app/frontend/pages/documents/${name}.ts`)
const { useDocumentAppearance } = await load('use_document_appearance')
const { useDocumentMode, useReadModeFallback } = await load('use_document_mode')
const { useDocumentTick } = await load('use_document_tick')
const { useDocumentWebmcp } = await load('use_document_webmcp')
const { useMobileSheets } = await load('use_mobile_sheets')
const { usePanelPreferences } = await load('use_panel_preferences')
const { useDocumentShortcuts } = await load('use_document_shortcuts')
const { useEditorPresence } = await load('use_editor_presence')
const { useDocumentChannel } = await load('use_document_channel')
const { useReviewHighlight, useTextTargeting } = await load('use_text_targeting')

class FakeElement {
  constructor(...selectors) { this.selectors = selectors }
  closest(list) { return list.split(', ').some((selector) => this.selectors.includes(selector)) ? this : null }
}

let listeners
let frames
function begin() {
  Object.assign(runtime, {
    slots: [], effects: [], visits: [], cookies: [], poll: [], themes: [], highlights: [], applied: [],
    channel: null, webmcp: null, mobile: false, reviewable: null, span: null, agents: null,
  })
  listeners = new Map()
  frames = new Map()
  let frame = 0
  globalThis.Element = FakeElement
  globalThis.requestAnimationFrame = (callback) => { frames.set(++frame, callback); return frame }
  globalThis.cancelAnimationFrame = (id) => frames.delete(id)
  globalThis.document = { documentElement: { dataset: {} } }
  globalThis.window = {
    innerHeight: 1000, scrolls: [], reloads: 0,
    scrollBy(options) { this.scrolls.push(options) },
    location: { reload: () => { window.reloads += 1 } },
    addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type, listener) => listeners.set(type, listeners.get(type).filter((entry) => entry !== listener)),
  }
}
function render(hook, ...args) {
  runtime.cursor = 0
  const result = hook(...args)
  for (const effect of runtime.effects.splice(0)) effect()
  return result
}
const unmount = () => runtime.slots.forEach((slot) => slot?.cleanup?.())
const emit = (type, event) => listeners.get(type).forEach((listener) => listener(event))
const runFrames = () => { const due = [...frames.values()]; frames.clear(); due.forEach((callback) => callback()) }
const key = (code, { meta = true, shift = false, key: name = '' } = {}) => ({
  code, key: name, metaKey: meta, ctrlKey: false, altKey: false, shiftKey: shift, repeat: false,
  defaultPrevented: false, preventDefault() { this.defaultPrevented = true },
})

const ALL_MODES = ['edit', 'suggest', 'comment', 'read']

test('appearance applies the theme and stores a rich width only once it is committed', () => {
  begin()
  const ui = { theme: 'proof', document_width: null, rich_content_width: null }
  const first = render(useDocumentAppearance, ui)
  assert.equal(document.documentElement.dataset.theme, 'proof')
  assert.equal(first.pageStyle, undefined)

  first.changeTheme('whitey')
  const themed = render(useDocumentAppearance, ui)
  assert.deepEqual(runtime.themes, ['whitey'])
  assert.equal(themed.theme, 'whitey')
  assert.equal(document.documentElement.dataset.theme, 'whitey')

  first.setDocumentWidth(700)
  emit('rich-width', { detail: { width: 900, commit: false } })
  assert.deepEqual(render(useDocumentAppearance, ui).pageStyle, { '--document-width': '700px', '--rich-content-width': '900px' })
  assert.deepEqual(runtime.cookies, [])
  emit('rich-width', { detail: { width: 910, commit: true } })
  emit('rich-width', { detail: { width: null, commit: true } })
  assert.deepEqual(runtime.cookies, [['pruf_rich_width', '910'], ['pruf_rich_width', 'default']])
  assert.deepEqual(render(useDocumentAppearance, ui).pageStyle, { '--document-width': '700px' })

  unmount()
  assert.deepEqual(listeners.get('rich-width'), [])
})

test('the mode follows access, and the demo document stays in Edit', () => {
  const mode = (options) => { begin(); return render(useDocumentMode, { slug: 'doc', urlMode: 'suggest', canWrite: true, canComment: true, ...options }) }
  const writer = mode({})
  assert.deepEqual(writer.availableModes, ALL_MODES)
  assert.deepEqual([writer.effectiveMode, writer.modeLocked, writer.isReading], ['suggest', false, false])
  const commenter = mode({ canWrite: false })
  assert.deepEqual(commenter.availableModes, ['comment', 'read'])
  assert.deepEqual([commenter.effectiveMode, commenter.modeLocked, commenter.isReading], ['read', false, true])
  const viewer = mode({ canWrite: false, canComment: false })
  assert.deepEqual([viewer.availableModes, viewer.modeLocked, viewer.demoModeLocked], [['read'], true, false])
  const demo = mode({ slug: 'demo' })
  assert.deepEqual([demo.effectiveMode, demo.modeLocked, demo.demoModeLocked], ['edit', true, true])
})

test('a mode change is a client-side visit that keeps state, and only to another mode on offer', () => {
  const change = (next, options) => {
    begin()
    render(useDocumentMode, { slug: 'a b', urlMode: 'edit', canWrite: true, canComment: true, ...options }).changeMode(next)
    return runtime.visits
  }
  const [{ kind, options }] = change('comment')
  assert.deepEqual([kind, options.url, options.preserveState, options.preserveScroll], ['push', '/d/a%20b/comment', true, true])
  assert.deepEqual(options.props({ kept: 1, ui: { theme: 'proof', mode: 'edit' } }), { kept: 1, ui: { theme: 'proof', mode: 'comment' } })
  assert.equal(change('read')[0].options.url, '/d/a%20b')

  assert.deepEqual(change('edit'), [])
  assert.deepEqual(change('edit', { urlMode: 'comment', canWrite: false }), [])
  assert.deepEqual(change('read', { slug: 'demo' }), [])
})

test('a mode that access no longer allows is replaced by Read, except on the demo document', () => {
  const fallback = (options) => {
    begin()
    render(useReadModeFallback, { slug: 'doc', urlMode: 'edit', availableModes: ['read'], demoModeLocked: false, ...options })
    return runtime.visits
  }
  const [{ kind, options }] = fallback()
  assert.deepEqual([kind, options.url, options.preserveState, options.preserveScroll], ['replace', '/d/doc', true, true])
  assert.deepEqual(options.props({ kept: 1, ui: { theme: 'proof', mode: 'edit' } }), { kept: 1, ui: { theme: 'proof', mode: 'read' } })
  assert.deepEqual(fallback({ urlMode: 'read' }), [])
  assert.deepEqual(fallback({ demoModeLocked: true }), [])
})

test('document updates count once a frame and stop with the handle', () => {
  begin()
  const bound = new Set()
  const ydoc = { on: (_type, fn) => bound.add(fn), off: (_type, fn) => bound.delete(fn) }
  const handle = { ydoc }
  assert.equal(render(useDocumentTick, handle), 0)
  const [bump] = bound
  bump()
  bump()
  assert.equal(frames.size, 1)
  runFrames()
  assert.equal(render(useDocumentTick, handle), 1)
  bump()
  render(useDocumentTick, null)
  assert.equal(frames.size, 0)
  assert.equal(bound.size, 0)
})

test('a WebMCP call sees the ownership, mode and editor current when it runs', () => {
  begin()
  const handleRef = { current: null }
  const modeRef = { current: 'edit' }
  const ownershipRef = { current: { yours: true, can_write: true, can_comment: true, link_access: 'edit', private: 1 } }
  render(useDocumentWebmcp, {
    slug: 'doc', contentFormat: 'markdown', webmcp: { tools: ['tool'], share_url: 'share' }, handleRef, modeRef, ownershipRef,
  })
  const { key: slug, tools, execute } = runtime.webmcp
  assert.deepEqual([slug, tools], ['doc', ['tool']])

  handleRef.current = 'late handle'
  modeRef.current = 'read'
  ownershipRef.current = { yours: false, can_write: false, can_comment: true, link_access: 'comment', private: 1 }
  const { note, ...viewerContext } = execute({ kind: 'http' }, {}, 'signal').viewerContext
  assert.match(note, /human viewer's capabilities/)
  assert.deepEqual(viewerContext, {
    ownership: { yours: false, can_write: false, can_comment: true, link_access: 'comment' }, mode: 'read', share_url: 'share',
  })
  assert.equal(execute({ kind: 'http' }, {}, 'signal').ran, 'manifest')
  const { ran, handle, canWrite, slug: target, contentFormat, signal } = execute({ kind: 'editor' }, {}, 'signal')
  assert.deepEqual([ran, handle, canWrite, target, contentFormat, signal], ['editor', 'late handle', false, 'doc', 'markdown', 'signal'])
})

test('the compact layout waits for the client, and leaving it closes the sheet', () => {
  begin()
  runtime.mobile = true
  assert.equal(render(useMobileSheets, false).isMobile, false)
  let sheets = render(useMobileSheets, true)
  assert.equal(sheets.isMobile, true)

  sheets.openSuggestionSheet('card')
  sheets = render(useMobileSheets, true)
  assert.deepEqual([sheets.activeSheet, sheets.sheetFocusKey], ['suggestions', 'card'])
  sheets.toggleSheet('comments')
  assert.equal(render(useMobileSheets, true).activeSheet, 'comments')
  sheets.toggleSheet('comments')
  assert.equal(render(useMobileSheets, true).activeSheet, null)
  sheets.toggleSheet('activity')
  sheets.closeSheet()
  assert.equal(render(useMobileSheets, true).activeSheet, null)

  sheets.setActiveSheet('activity')
  runtime.mobile = false
  render(useMobileSheets, true)
  assert.equal(render(useMobileSheets, true).activeSheet, null)
})

test('panel preferences start from the server and write back what changed', () => {
  begin()
  const ui = { panel_open: true, focus_mode: false, activity_filter: 'all', comments_resolved: false, activity_expanded: false }
  const render1 = () => render(usePanelPreferences, ui)
  const first = render1()
  assert.deepEqual(runtime.cookies.splice(0), [['pruf_panel', true], ['pruf_focus', false]])

  first.togglePanel()
  assert.equal(render1().panelOpen, false)
  first.toggleFocus()
  assert.equal(render1().focusMode, true)
  first.changeCommentsResolved(true)
  first.activityPreferences.onFilterChange('edits')
  first.activityPreferences.onExpandedChange(true)
  const last = render1()
  assert.deepEqual([last.commentsResolved, last.activityPreferences.filter, last.activityPreferences.expanded], [true, 'edits', true])
  assert.deepEqual(runtime.cookies, [
    ['pruf_panel', false], ['pruf_focus', true],
    ['pruf_comments_resolved', true], ['pruf_activity_filter', 'edits'], ['pruf_activity_expanded', true],
  ])
})

test('each shortcut does its own action, and a locked mode leaves the key alone', () => {
  const press = (event, options) => {
    begin()
    const did = []
    render(useDocumentShortcuts, {
      theme: 'proof', availableModes: ALL_MODES, modeLocked: false,
      changeTheme: (theme) => did.push(theme), changeMode: (mode) => did.push(mode),
      togglePanel: () => did.push('panel'), toggleFocus: () => did.push('focus'), ...options,
    })
    emit('keydown', event)
    unmount()
    assert.deepEqual(listeners.get('keydown'), [])
    return [did, event.defaultPrevented]
  }
  assert.deepEqual(press(key('Digit3')), [['comment'], true])
  assert.deepEqual(press(key('Digit3'), { modeLocked: true }), [[], false])
  assert.deepEqual(press(key('Digit1'), { availableModes: ['comment', 'read'] }), [[], false])
  assert.deepEqual(press(key('Backslash')), [['panel'], true])
  assert.deepEqual(press(key('Period')), [['focus'], true])
  assert.deepEqual(press(key('Period', { shift: true })), [['whitey'], true])
  assert.deepEqual(press(key('Period', { shift: true }), { theme: 'whitey' }), [['proof'], true])
  assert.deepEqual(press(key('Digit3', { meta: false })), [[], false])
  assert.deepEqual(press(key('KeyK')), [[], false])
})

test('the editor gets this viewer and the present agents, and polls only while agents are shown', () => {
  begin()
  const local = []
  const ctx = []
  const handle = {
    provider: { awareness: { setLocalStateField: (...field) => local.push(field) } },
    editor: { action: (run) => run({ set: (...entry) => ctx.push(entry) }) },
  }
  const identity = { name: 'Ada' }
  const agents = [{ agent_name: 'Scout', location_text: 'Intro' }]
  render(useEditorPresence, null, identity, [])
  assert.deepEqual([local, runtime.agents, runtime.poll], [[], null, ['stop']])
  render(useEditorPresence, handle, identity, agents)
  assert.deepEqual(local, [['user', identity]])
  assert.deepEqual(ctx, [['identity', { name: 'Ada' }]])
  assert.deepEqual(runtime.agents, [{ name: 'Scout', location: 'Intro' }])
  assert.deepEqual(runtime.poll, ['stop', 'start'])
  assert.deepEqual(runtime.pollOptions, [45000, { only: ['presences'], async: true }, { autoStart: false }])
  render(useEditorPresence, handle, { name: 'Grace' }, [])
  assert.equal(local.length, 2)
  assert.deepEqual(runtime.poll, ['stop', 'start', 'stop'])
})

function openChannel(options) {
  begin()
  const presencePoll = { stop: () => runtime.poll.push('stop') }
  const provider = { bound: [], on: (...entry) => provider.bound.push(entry), off: (_type, fn) => { provider.bound = provider.bound.filter((entry) => entry[1] !== fn) } }
  const titles = []
  const args = {
    slug: 'doc', handle: { provider }, yours: false, connectionIdentity: 'guest', presencePoll,
    onTitle: (title) => titles.push(title), onWritingPass: 'pass', ...options,
  }
  return { provider, titles, again: () => render(useDocumentChannel, args), result: render(useDocumentChannel, args) }
}

test('a deleted or replaced document stops the presence poll before leaving', () => {
  openChannel()
  runtime.visits.push = function (visit) { runtime.poll.push(visit.options); return Array.prototype.push.call(this, visit) }
  runtime.channel.onDeleted()
  assert.deepEqual(runtime.poll, ['stop', '/'])
  assert.equal(runtime.visits[0].kind, 'visit')

  const { result } = openChannel()
  runtime.channel.onContentReset()
  assert.equal(result.reloadAfterContentReset, runtime.channel.onContentReset)
  assert.deepEqual([runtime.poll, window.reloads], [['stop'], 1])
})

test('changed access reloads only what it can affect, and only while the editor is there', () => {
  const only = (options) => { openChannel(options); runtime.channel.onEditingLock(); return runtime.visits[0].options }
  assert.deepEqual(only({ yours: true }), { only: ['ownership'], async: true })
  assert.deepEqual(only({ yours: false }), { only: ['document', 'ownership'], async: true })

  const { provider } = openChannel()
  const [[type, denied]] = provider.bound
  assert.equal(type, 'write-denied')
  denied()
  assert.deepEqual(runtime.visits[0], { kind: 'reload', options: { only: ['document', 'ownership', 'viewer'], async: true } })
  unmount()
  assert.deepEqual(provider.bound, [])
})

test('the channel passes titles and writing passes on and announces a newer version', () => {
  const { titles, again, result } = openChannel()
  const { slug, connectionIdentity, onWritingPass } = runtime.channel
  assert.deepEqual([slug, connectionIdentity, onWritingPass], ['doc', 'guest', 'pass'])
  runtime.channel.onTitle('New')
  assert.deepEqual(titles, ['New'])
  assert.equal(result.newVersionAvailable, false)
  runtime.channel.onVersionAvailable()
  assert.equal(again().newVersionAvailable, true)
})

const SPAN = { from: 4, to: 9, attrs: { kind: 'ai' } }
const REVIEW = { kind: 'review', target: { bound: SPAN }, keyboard: false }

// The page holds the target, so a set here is what its next render passes in.
function targeting(options = {}) {
  begin()
  const page = {
    viewRef: { current: null }, handleRef: { current: null }, modeRef: { current: 'edit' },
    ownershipRef: { current: { can_write: true } }, textTarget: null, reviewItems: [], isMobile: false,
    sets: [],
    setTextTarget: (target) => { page.sets.push(target); page.textTarget = target },
    sheets: [], openSuggestionSheet: (sheet) => page.sheets.push(sheet), ...options,
  }
  page.render = () => Object.assign(page, { hook: render(useTextTargeting, page) }).hook
  page.render()
  return page
}
function makeView({ from = 5, to = from, text = '', block = '', focused = true, editable = true } = {}) {
  const view = {
    editable, focuses: 0, dispatched: [],
    hasFocus: () => focused,
    focus: () => { view.focuses += 1 },
    dispatch: (tr) => view.dispatched.push(tr),
    coordsAtPos: () => ({ top: 500 }),
    state: {
      selection: { from, to, head: from, empty: from === to, $head: { parent: { isTextblock: true, textContent: block } } },
      doc: { textBetween: () => text },
      tr: { setSelection: (selection) => ({ scrollIntoView: () => selection }) },
    },
  }
  return view
}

test('a selection becomes the target before a tap, a paragraph, or a review passage', () => {
  const page = targeting({ isMobile: true, modeRef: { current: 'comment' }, reviewItems: [{ key: 'card', range: { from: 1, to: 9 } }] })
  runtime.span = SPAN
  const select = (view) => { page.hook.handleSelection(view); return page.textTarget }
  assert.deepEqual(select(makeView({ from: 2, to: 6, text: 'words' })), { kind: 'selection', text: 'words' })

  assert.equal(select(makeView({ block: 'Paragraph' })), null)
  assert.deepEqual(page.sheets, ['card'])

  page.reviewItems = [{ key: 'inline', inline: true, range: { from: 1, to: 9 } }, { key: 'before', range: { from: 1, to: 3 } }, { key: 'after', range: { from: 20, to: 30 } }]
  page.render()
  assert.deepEqual(select(makeView({ block: 'Paragraph' })), { kind: 'comment', text: 'Paragraph' })

  assert.deepEqual(select(makeView({ block: '  ' })), REVIEW)
  page.modeRef.current = 'edit'
  assert.deepEqual(select(makeView({ block: 'Paragraph' })), REVIEW)
  runtime.span = null
  assert.equal(select(makeView({ block: 'Paragraph' })), null)
  assert.deepEqual(page.sheets, ['card'])
})

test('a desktop tap never opens the suggestion sheet', () => {
  const page = targeting({ reviewItems: [{ key: 'card', range: { from: 1, to: 9 } }] })
  page.hook.handleSelection(makeView())
  assert.deepEqual(page.sheets, [])
  page.isMobile = true
  page.render()
  page.hook.handleSelection(makeView())
  assert.deepEqual(page.sheets, ['card'])
})

test('an unfocused editable view clears the target, and Read mode leaves it alone', () => {
  const page = targeting({ textTarget: { kind: 'selection', text: 'kept' }, modeRef: { current: 'read' } })
  const selected = { from: 2, to: 6, text: 'words', focused: false }
  page.hook.handleSelection(makeView(selected))
  assert.deepEqual(page.textTarget, { kind: 'selection', text: 'kept' })
  page.modeRef.current = 'edit'
  page.hook.handleSelection(makeView(selected))
  assert.equal(page.textTarget, null)
  page.hook.handleSelection(makeView({ ...selected, editable: false }))
  assert.deepEqual(page.textTarget, { kind: 'selection', text: 'words' })
})

test('a paragraph comment is capped at a whole character', () => {
  const page = targeting({ modeRef: { current: 'comment' } })
  page.hook.handleSelection(makeView({ block: `${'a'.repeat(10 * 1024 - 1)}éb` }))
  assert.equal(page.textTarget.text, 'a'.repeat(10 * 1024 - 1))
})

test('a document change opens nothing, and says when the passage under review is gone', () => {
  const page = targeting()
  runtime.span = SPAN
  page.hook.handleSelection(makeView(), 'document')
  assert.equal(page.textTarget, null)

  page.textTarget = REVIEW
  page.render()
  runtime.reviewable = SPAN
  page.hook.handleSelection(makeView(), 'document')
  assert.equal(page.textTarget, REVIEW)
  runtime.reviewable = null
  page.hook.handleSelection(makeView(), 'document')
  assert.equal(page.textTarget, null)
  assert.match(page.render().reviewNotice, /That passage changed/)
  page.hook.handleSelection(makeView())
  assert.equal(page.render().reviewNotice, '')
})

test('a click away drops the target, but not on its own chrome or in the text', () => {
  const page = targeting()
  const view = makeView({ from: 2, to: 6, text: 'words' })
  page.handleRef.current = { editor: { action: (run) => run({ get: () => view }) } }
  const click = (...selectors) => {
    page.textTarget = REVIEW
    emit('pointerdown', { target: new FakeElement(...selectors) })
    return page.textTarget
  }
  assert.equal(click('.header'), null)
  for (const chrome of ['.selection-toolbar', '.review-popover', '.comment-composer--anchored', '.prov-summary']) {
    assert.equal(click(chrome), REVIEW)
  }
  assert.equal(click('.milkdown .ProseMirror'), REVIEW)
  assert.equal(frames.size, 0)

  // Attributed text is looked at again once the click has settled.
  click('.milkdown .ProseMirror', '[data-provenance]')
  click('.milkdown .ProseMirror', '[data-provenance]')
  assert.equal(frames.size, 1)
  runFrames()
  assert.deepEqual(page.textTarget, { kind: 'selection', text: 'words' })

  click('.milkdown .ProseMirror', '[data-provenance]')
  page.handleRef.current = { editor: { action: () => { throw new Error('torn down') } } }
  runFrames()
  assert.equal(page.textTarget, REVIEW)

  click('.milkdown .ProseMirror', '[data-provenance]')
  unmount()
  assert.equal(frames.size, 0)
  assert.deepEqual(listeners.get('pointerdown'), [])
})

test('stepping through provenance reveals the passage, and closing returns to the control', () => {
  const page = targeting()
  const view = makeView()
  page.handleRef.current = { editor: { action: (run) => run({ get: () => view }) } }
  const trigger = { isConnected: true, focuses: 0, focus: () => { trigger.focuses += 1 } }

  page.hook.navigateProvenance('unreviewed', trigger, true)
  assert.match(page.render().reviewNotice, /All caught up/)
  page.hook.navigateProvenance('human', trigger, true)
  assert.match(page.render().reviewNotice, /No human text/)

  // The view reports the move as a selection; it must not choose a target itself.
  view.dispatch = (tr) => { view.dispatched.push(tr); page.hook.handleSelection(makeView({ from: 1, to: 2, text: 'stray' })) }
  runtime.span = SPAN
  page.sets.length = 0
  page.hook.navigateProvenance('ai', trigger, true)
  assert.deepEqual(page.sets, [{ ...REVIEW, keyboard: true }])
  assert.deepEqual(view.dispatched, [{ from: 9, to: 4 }])
  assert.deepEqual(window.scrolls, [{ top: 200, behavior: 'instant' }])
  assert.equal(trigger.focuses, 0)

  page.hook.closeReview()
  assert.equal(page.textTarget, null)
  assert.equal(trigger.focuses, 1)
  trigger.isConnected = false
  page.viewRef.current = view
  view.focuses = 0
  page.hook.closeReview()
  assert.deepEqual([trigger.focuses, view.focuses], [1, 1])

  runtime.span = { ...SPAN, attrs: { kind: 'human' } }
  page.hook.navigateProvenance('human', trigger, true)
  assert.equal(page.textTarget, null)
  assert.match(page.render().reviewNotice, /Human-written passage selected/)
  assert.equal(trigger.focuses, 2)

  page.modeRef.current = 'read'
  view.dispatched.length = 0
  page.hook.navigateProvenance('human', trigger, true)
  assert.deepEqual(view.dispatched, [])
})

test('a review decision is applied only in Edit with write access to a passage still there', () => {
  const page = targeting({ textTarget: REVIEW })
  page.viewRef.current = makeView()
  runtime.reviewable = SPAN
  page.hook.handleAdvance('reviewed')
  assert.deepEqual(runtime.applied, [{ span: SPAN, state: 'reviewed' }])
  page.modeRef.current = 'suggest'
  page.hook.handleAdvance('reviewed')
  page.modeRef.current = 'edit'
  page.ownershipRef.current = { can_write: false }
  page.hook.handleAdvance('reviewed')
  assert.equal(runtime.applied.length, 1)

  page.ownershipRef.current = { can_write: true }
  runtime.reviewable = null
  page.hook.handleAdvance('reviewed')
  assert.equal(page.textTarget, null)
  assert.match(page.render().reviewNotice, /That passage changed/)
})

test('the passage under review stays tinted until it closes, and Escape closes it once', () => {
  begin()
  let closed = 0
  const args = {
    viewRef: { current: {} }, textTarget: REVIEW, reviewActive: true, liveReviewSpan: SPAN, docTick: 0,
    closeReview: () => { closed += 1 },
  }
  render(useReviewHighlight, args)
  assert.deepEqual(runtime.highlights, [['review-target', [{ from: 4, to: 9 }]]])
  render(useReviewHighlight, { ...args, docTick: 1 })
  assert.equal(runtime.highlights.length, 3, 'an edit measures the passage again')

  emit('keydown', key('KeyA', { key: 'a' }))
  emit('keydown', Object.assign(key('Escape', { key: 'Escape' }), { defaultPrevented: true }))
  assert.equal(closed, 0)
  const escape = key('Escape', { key: 'Escape' })
  emit('keydown', escape)
  assert.deepEqual([closed, escape.defaultPrevented], [1, true])

  render(useReviewHighlight, { ...args, docTick: 1, textTarget: null, reviewActive: false, liveReviewSpan: null })
  assert.deepEqual(runtime.highlights.slice(-2), [['review-target', null], ['review-target', []]])
  assert.deepEqual(listeners.get('keydown'), [])
})
