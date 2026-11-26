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

const SERVER_BODY = { error: 'Write rate limit exceeded; retry later.' }
const WINDOW_SECONDS = 600

// Answers one write with `status` from a real server and returns the envelope.
async function callAnswering(t, status, requestFields = {}) {
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' })
    response.end(JSON.stringify(SERVER_BODY))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { value: { origin }, configurable: true })
  t.after(() => {
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
    else delete globalThis.location
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })

  const result = await executeManifestTool(
    {
      name: 'add_comment',
      description: '',
      kind: 'request',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      annotations: { read_only_hint: false, untrusted_content_hint: false },
      include_viewer_context: false,
      request: {
        method: 'POST',
        url: `${origin}/api/docs/demo/comments`,
        path_params: [],
        body_params: ['body'],
        agent_identity: 'required',
        ...requestFields,
      },
    },
    { agent_name: 'Test agent', body: 'Hello' },
  )
  return { isError: result.isError, payload: JSON.parse(result.content[0].text) }
}

test('a 429 reports the tool rate limit window as retry_after_seconds', async (t) => {
  const { isError, payload } = await callAnswering(t, 429, { rate_limit_window_seconds: WINDOW_SECONDS })
  assert.equal(isError, true)
  assert.deepEqual(payload, { status: 429, ...SERVER_BODY, retry_after_seconds: 600 })
})

test('a 429 from a tool without a window has no retry_after_seconds', async (t) => {
  const { isError, payload } = await callAnswering(t, 429)
  assert.equal(isError, true)
  assert.deepEqual(payload, { status: 429, ...SERVER_BODY })
})

for (const status of [403, 404, 409, 422, 423, 500, 503]) {
  test(`a ${status} has no retry_after_seconds even when the tool has a window`, async (t) => {
    const { isError, payload } = await callAnswering(t, status, { rate_limit_window_seconds: WINDOW_SECONDS })
    assert.equal(isError, true)
    assert.deepEqual(payload, { status, ...SERVER_BODY })
  })
}
