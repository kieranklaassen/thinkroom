import assert from 'node:assert/strict'
import test from 'node:test'
import { openEditorLink } from '../../app/frontend/editor/link_opening.ts'

const ORIGIN = 'https://pad.example'
class FakeNode {}
class FakeElement extends FakeNode {
  constructor(anchor) {
    super()
    this.anchor = anchor
  }
  closest = () => this.anchor
}
class FakeMouseEvent {
  button = 0
  defaultPrevented = false
  constructor(target, options) {
    Object.assign(this, { target }, options)
  }
  preventDefault() {
    this.defaultPrevented = true
  }
}
Object.assign(globalThis, { Node: FakeNode, Element: FakeElement, MouseEvent: FakeMouseEvent })

// Clicks a link to `href` and reports where it went.
function click(href, { native = false, bridge = true, outside = false, text = false, ...options } = {}) {
  const went = []
  globalThis.document = { documentElement: { hasAttribute: (name) => native && name === 'data-native-app' } }
  globalThis.window = {
    location: { href: `${ORIGIN}/d/here`, origin: ORIGIN, assign: (url) => went.push(['assign', url]) },
    open: (...args) => went.push(['open', ...args]),
    RubyNative: bridge ? { visit: (url) => went.push(['visit', url]) } : undefined,
  }
  const anchor = href === null ? null : { href }
  const element = new FakeElement(anchor)
  const target = text ? Object.assign(new FakeNode(), { parentElement: element }) : element
  const event = options.event ?? new FakeMouseEvent(target, options)
  const before = event.defaultPrevented
  const handled = openEditorLink({ dom: { contains: (node) => !outside && node === anchor } }, event)
  return { handled, went, prevented: event.defaultPrevented !== before }
}
const left = { handled: false, went: [], prevented: false }
const opened = (url) => ({ handled: true, went: [['open', url, '_blank', 'noopener,noreferrer']], prevented: true })

test('a link opens in a new tab without an opener', () => {
  assert.deepEqual(click('https://example.com/a'), opened('https://example.com/a'))
  assert.deepEqual(click('/d/other', { text: true }), opened(`${ORIGIN}/d/other`))
  for (const href of ['mailto:a@example.com', 'tel:123']) assert.deepEqual(click(href), opened(href))
})

test('other clicks are left alone', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com/', 'https://[', null]) {
    assert.deepEqual(click(href), left, String(href))
  }
  assert.deepEqual(click('https://example.com/', { button: 1 }), left)
  assert.deepEqual(click('https://example.com/', { defaultPrevented: true }), left)
  assert.deepEqual(click('https://example.com/', { outside: true }), left)
  assert.deepEqual(click('https://example.com/', { event: { button: 0, target: new FakeElement(), defaultPrevented: false } }), left)
})

test('the native shell keeps same-origin pages in its web view and the session with them', () => {
  const visited = (how) => ({ handled: true, went: [[how, `${ORIGIN}/d/other`]], prevented: true })
  assert.deepEqual(click('/d/other', { native: true }), visited('visit'))
  assert.deepEqual(click('/d/other', { native: true, bridge: false }), visited('assign'))
})

test('the native shell opens stored files and other sites externally', () => {
  const file = `${ORIGIN}/rails/active_storage/blobs/x/file.pdf`
  assert.deepEqual(click(file, { native: true }), opened(file))
  assert.deepEqual(click('https://example.com/a', { native: true }), opened('https://example.com/a'))
})
