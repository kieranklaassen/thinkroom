import assert from 'node:assert/strict'
import test from 'node:test'
import { csrfToken, patchJSON, postJSON } from '../../app/frontend/lib/csrf.ts'

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
    assert.equal(headers.get('X-Requested-With'), 'XMLHttpRequest')
  })
}

test('a save sends the token of the current session, not the one the page loaded with', (t) => {
  const originalDocument = globalThis.document
  t.after(() => {
    globalThis.document = originalDocument
  })
  const page = { cookie: '', querySelector: () => ({ content: 'page-load-token' }) }
  globalThis.document = page

  page.cookie = 'proof_theme=whitey; XSRF-TOKEN=signed-in-token%3D%3D; other=1'
  assert.equal(csrfToken(), 'signed-in-token==')

  page.cookie = 'XSRF-TOKEN=signed-out-token'
  assert.equal(csrfToken(), 'signed-out-token')

  for (const unusable of ['', 'XSRF-TOKEN=', 'XSRF-TOKEN=%', 'NOT-XSRF-TOKEN=other']) {
    page.cookie = unusable
    assert.equal(csrfToken(), 'page-load-token', unusable)
  }
  Object.defineProperty(page, 'cookie', {
    get() {
      throw new Error('cookies are unavailable')
    },
  })
  assert.equal(csrfToken(), 'page-load-token')
})
