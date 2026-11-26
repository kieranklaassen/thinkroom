import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Resolve Vite/TS extensionless relative imports (./webmcp -> ./webmcp.ts).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
      const file = path.resolve(path.dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`)
      if (existsSync(file)) return nextResolve(pathToFileURL(file).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { executeManifestTool } = await import('../../app/frontend/lib/webmcp_execute.ts')

const LIMIT_MS = 60_000

// Holds only the call's own limit. Node's mocked timers would also capture the
// HTTP client's keep-alive timers, which outlive a test: clearing one under a
// later test's mock removes whatever sits at the same queue position there.
function holdLimitTimer(t) {
  const { setTimeout: realSetTimeout, clearTimeout: realClearTimeout } = globalThis
  const held = new Map()
  let now = 0
  let started = 0
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== LIMIT_MS) return realSetTimeout(callback, delay, ...args)
    const timer = {}
    started += 1
    held.set(timer, { callback, at: now + delay })
    return timer
  }
  globalThis.clearTimeout = (timer) => {
    if (!held.delete(timer)) realClearTimeout(timer)
  }
  t.after(() => {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  })
  return {
    started: () => started,
    pending: () => held.size,
    tick: (ms) => {
      now += ms
      for (const [timer, { callback, at }] of held) {
        if (at > now) continue
        held.delete(timer)
        callback()
      }
    },
  }
}

// A real server, so fetch and the body stream honor the abort signal for real.
// `hang` sends nothing; `stall` sends headers and half a body, then nothing.
async function setup(t) {
  const arrivals = []
  const waiting = []
  const server = createServer((request, response) => {
    if (request.url === '/api/fast') return response.end('{"ok":true}')
    if (request.url === '/api/fail') return response.writeHead(500).end('{"error":"broken"}')
    if (request.url === '/api/stall') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.write('{"half":')
    }
    const arrival = {
      response,
      closed: new Promise((resolve) => response.once('close', resolve)),
    }
    const next = waiting.shift()
    if (next) next(arrival)
    else arrivals.push(arrival)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  const origin = `http://127.0.0.1:${server.address().port}`
  Object.defineProperty(globalThis, 'location', { value: { origin }, configurable: true })
  t.after(() => {
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
    else delete globalThis.location
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })

  // The client resolves fetch() once headers arrive; hook it to know when a
  // stalled call has moved on to reading the body.
  let headersReceived
  const headers = new Promise((resolve) => (headersReceived = resolve))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args)
    // After the caller's continuation, so it is already reading the body.
    setImmediate(headersReceived)
    return response
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  return {
    headers,
    ...holdLimitTimer(t),
    arrived: () =>
      arrivals.length ? Promise.resolve(arrivals.shift()) : new Promise((resolve) => waiting.push(resolve)),
    call: (route, { method = 'GET', signal } = {}) =>
      executeManifestTool(
        {
          name: 'tool',
          description: '',
          kind: 'request',
          input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
          annotations: { read_only_hint: method === 'GET', untrusted_content_hint: false },
          include_viewer_context: false,
          request: {
            method,
            url: `${origin}/api/${route}`,
            path_params: [],
            body_params: [],
            agent_identity: 'omit',
          },
        },
        {},
        { signal },
      ),
  }
}

function errorOf(result) {
  assert.equal(result.isError, true)
  return JSON.parse(result.content[0].text)
}

// Keeps a missing bound a prompt failure instead of a hung run.
const bounded = { timeout: 5000 }

test('a request that never answers returns the timed out envelope and drops the connection', bounded, async (t) => {
  const h = await setup(t)
  const result = h.call('hang')
  const arrival = await h.arrived()
  h.tick(LIMIT_MS)
  const error = errorOf(await result)
  assert.equal(error.error, 'timed out')
  assert.equal(error.timeout_seconds, 60)
  await arrival.closed
})

test('a body that stalls after the headers is bounded too', bounded, async (t) => {
  const h = await setup(t)
  const result = h.call('stall', { signal: new AbortController().signal })
  await h.headers
  h.tick(LIMIT_MS)
  assert.equal(errorOf(await result).error, 'timed out')
})

test('the limit covers the whole call rather than restarting for the body', bounded, async (t) => {
  const h = await setup(t)
  const result = h.call('hang')
  const { response } = await h.arrived()
  h.tick(LIMIT_MS - 1)
  response.writeHead(200)
  response.write('{')
  await h.headers
  h.tick(1)
  assert.equal(errorOf(await result).error, 'timed out')
})

test('a slow answer inside the limit still succeeds', bounded, async (t) => {
  const h = await setup(t)
  const result = h.call('hang')
  const { response } = await h.arrived()
  h.tick(LIMIT_MS - 1)
  response.end('{"slow":true}')
  assert.deepEqual(await result, { content: [{ type: 'text', text: '{"slow":true}' }] })
})

test('a timed out write warns that it may have been applied; a read does not', bounded, async (t) => {
  const h = await setup(t)
  const write = h.call('hang', { method: 'POST' })
  await h.arrived()
  h.tick(LIMIT_MS)
  assert.match(errorOf(await write).detail, /may still have been applied/)

  const read = h.call('hang')
  await h.arrived()
  h.tick(LIMIT_MS)
  assert.doesNotMatch(errorOf(await read).detail, /applied/)
})

for (const [label, reason] of [
  ['default reason', undefined],
  ['custom reason', 'stopped by the agent'],
  ["caller's own TimeoutError", new DOMException('agent deadline', 'TimeoutError')],
]) {
  test(`a caller abort stays cancelled while waiting for headers (${label})`, bounded, async (t) => {
    const h = await setup(t)
    const controller = new AbortController()
    const result = h.call('hang', { signal: controller.signal })
    await h.arrived()
    controller.abort(reason)
    assert.deepEqual(errorOf(await result), { error: 'cancelled' })
  })

  test(`a caller abort stays cancelled while reading the body (${label})`, bounded, async (t) => {
    const h = await setup(t)
    const controller = new AbortController()
    const result = h.call('stall', { signal: controller.signal })
    await h.headers
    controller.abort(reason)
    assert.deepEqual(errorOf(await result), { error: 'cancelled' })
  })
}

test('a signal aborted before the call returns cancelled', bounded, async (t) => {
  const h = await setup(t)
  assert.deepEqual(errorOf(await h.call('fast', { signal: AbortSignal.abort() })), { error: 'cancelled' })
})

// Each ending of a call, driven to completion.
const ENDINGS = {
  success: (h, options) => h.call('fast', options),
  'error status': (h, options) => h.call('fail', options),
  'connection lost before the headers': async (h, options) => {
    const result = h.call('hang', options)
    ;(await h.arrived()).response.destroy()
    return result
  },
  'connection lost in the body': async (h, options) => {
    const result = h.call('stall', options)
    await h.headers
    ;(await h.arrived()).response.destroy()
    return result
  },
  'caller abort before the headers': async (h, options) => {
    const controller = new AbortController()
    const result = h.call('hang', { ...options, signal: controller.signal })
    await h.arrived()
    controller.abort()
    return result
  },
  'caller abort in the body': async (h, options) => {
    const controller = new AbortController()
    const result = h.call('stall', { ...options, signal: controller.signal })
    await h.headers
    controller.abort()
    return result
  },
}

for (const [ending, run] of Object.entries(ENDINGS)) {
  test(`no limit timer is left after: ${ending}`, bounded, async (t) => {
    const h = await setup(t)
    await run(h)
    assert.deepEqual([h.started(), h.pending()], [1, 0])
  })
}

const UNANSWERED = {
  'connection lost before the headers': 'unreachable',
  'connection lost in the body': null, // the runtime's own message
  'caller abort before the headers': 'cancelled',
  'caller abort in the body': 'cancelled',
}

for (const [ending, code] of Object.entries(UNANSWERED)) {
  test(`a write warns that it may have been applied: ${ending}`, bounded, async (t) => {
    const h = await setup(t)
    const error = errorOf(await ENDINGS[ending](h, { method: 'POST' }))
    if (code) assert.equal(error.error, code)
    assert.match(error.detail, /(^|\. )The write may still have been applied; check before retrying\.$/)
  })

  test(`a read does not warn: ${ending}`, bounded, async (t) => {
    const h = await setup(t)
    assert.doesNotMatch(JSON.stringify(errorOf(await ENDINGS[ending](h))), /applied/)
  })
}

test('a write that was never sent does not warn that it may have been applied', bounded, async (t) => {
  const h = await setup(t)
  const result = h.call('fast', { method: 'POST', signal: AbortSignal.abort() })
  assert.deepEqual(errorOf(await result), { error: 'cancelled' })
})
