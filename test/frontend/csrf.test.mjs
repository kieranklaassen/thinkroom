import assert from 'node:assert/strict'
import test from 'node:test'
import { adoptSessionCsrfToken, jsonHeaders, patchJSON, postJSON } from '../../app/frontend/lib/csrf.ts'

globalThis.document ??= {
  querySelector: () => ({ content: 'test-csrf-token' }),
}

for (const [method, send] of Object.entries({ POST: postJSON, PATCH: patchJSON })) {
  // Following the redirect turns a POST into a GET of the page; a PATCH stays a
  // PATCH, which the page has no route for.
  const followed =
    method === 'POST'
      ? { ok: true, status: 200, redirected: true }
      : { ok: false, status: 404, redirected: true }

  test(`a ${method} refused by the server reaches the caller as the refusal`, async (t) => {
    const originalFetch = globalThis.fetch
    let request
    // The server's answer to a refused write: 423 to a client asking for JSON,
    // otherwise a redirect that fetch follows.
    globalThis.fetch = async (_url, init) => {
      request = init
      return new Headers(init.headers).get('Accept') === 'application/json'
        ? { ok: false, status: 423, redirected: false }
        : followed
    }
    t.after(() => {
      globalThis.fetch = originalFetch
    })

    const response = await send('/d/demo-slug/write', { a: 1 })
    assert.equal(response.ok, false)
    assert.equal(response.status, 423)

    assert.equal(request.method, method)
    const headers = new Headers(request.headers)
    assert.equal(headers.get('Content-Type'), 'application/json')
    assert.equal(headers.get('X-CSRF-Token'), 'test-csrf-token')
  })
}

test('adopting the session token replaces the first load token, and a missing cookie keeps it', (t) => {
  const original = globalThis.document
  const meta = { content: 'first-load' }
  globalThis.document = { cookie: 'pruf_focus=1', querySelector: () => meta }
  t.after(() => {
    globalThis.document = original
  })

  adoptSessionCsrfToken()
  assert.equal(jsonHeaders()['X-CSRF-Token'], 'first-load')

  document.cookie = 'OTHER-XSRF-TOKEN=no; XSRF-TOKEN=a-b%2Bc%3D%3D; pruf_focus=1'
  assert.equal(jsonHeaders()['X-CSRF-Token'], 'first-load', 'the cookie alone changes nothing')
  adoptSessionCsrfToken()
  assert.equal(jsonHeaders()['X-CSRF-Token'], 'a-b+c==')
})
