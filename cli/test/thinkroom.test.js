import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const cli = path.join(repositoryRoot, 'cli', 'bin', 'thinkroom.js')

async function temporaryDirectory(name) {
  return mkdtemp(path.join(tmpdir(), `thinkroom-${name}-`))
}

function runCli(args, { cwd, configHome, input = '', env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: cwd || repositoryRoot,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: configHome || path.join(tmpdir(), 'thinkroom-unused-config'),
        THINKROOM_SKILL_SOURCE: path.join(repositoryRoot, 'cli', 'skill', 'thinkroom'),
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

async function startServer(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function jsonRequest(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

test('help, version, and prime work without a network or login', async () => {
  const root = await temporaryDirectory('prime')
  const configHome = path.join(root, 'config')
  await mkdir(path.join(root, '.git'))
  await mkdir(path.join(root, 'docs', 'solutions', 'architecture'), { recursive: true })
  await mkdir(path.join(root, 'docs', 'plans'), { recursive: true })
  await writeFile(path.join(root, 'AGENTS.md'), '# Instructions\n')
  await writeFile(path.join(root, 'CONCEPTS.md'), '# Concepts\n')
  await writeFile(path.join(root, 'docs', 'solutions', 'architecture', 'durable.md'), '# Durable\n')
  await writeFile(path.join(root, 'docs', 'plans', 'active.md'), '---\nstatus: active\n---\n')

  const version = await runCli(['--version'], { cwd: root, configHome })
  assert.equal(version.code, 0)
  assert.match(version.stdout, /^0\.1\.0/)

  const primed = await runCli(['prime'], { cwd: path.join(root, 'docs'), configHome })
  assert.equal(primed.code, 0, primed.stderr)
  assert.match(primed.stdout, /AGENTS\.md/)
  assert.match(primed.stdout, /CONCEPTS\.md/)
  assert.match(primed.stdout, /docs\/solutions\/architecture\/durable\.md/)
  assert.match(primed.stdout, /docs\/plans\/active\.md/)
  assert.match(primed.stdout, /not connected/)
})

test('init installs the bundled skill into detected agent roots', async () => {
  const root = await temporaryDirectory('skill')
  const configHome = path.join(root, 'config')
  await mkdir(path.join(root, '.git'))
  await mkdir(path.join(root, '.claude'))

  const initialized = await runCli(['init'], { cwd: root, configHome })
  assert.equal(initialized.code, 0, initialized.stderr)
  assert.match(initialized.stdout, /\.claude\/skills\/thinkroom/)

  const installed = await readFile(path.join(root, '.claude', 'skills', 'thinkroom', 'SKILL.md'), 'utf8')
  const source = await readFile(path.join(repositoryRoot, 'cli', 'skill', 'thinkroom', 'SKILL.md'), 'utf8')
  assert.equal(installed, source)
  assert.equal(await readFile(path.join(root, '.claude', 'skills', 'thinkroom', 'agents', 'openai.yaml'), 'utf8'),
    await readFile(path.join(repositoryRoot, 'cli', 'skill', 'thinkroom', 'agents', 'openai.yaml'), 'utf8'))
})

test('login ignores stale credentials, saves a protected token, and links document creation', async (t) => {
  const root = await temporaryDirectory('login')
  const configHome = path.join(root, 'config')
  await mkdir(path.join(configHome, 'thinkroom'), { recursive: true })
  await writeFile(path.join(configHome, 'thinkroom', 'config.json'), JSON.stringify({ token: 'trm_stale' }))
  const seen = { polls: 0 }

  const server = await startServer(async (request, response) => {
    if (request.url === '/api/cli/device_authorizations' && request.method === 'POST') {
      assert.equal(request.headers.authorization, undefined)
      return sendJson(response, 201, {
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_url: `${server.url}/cli/authorize?code=ABCD-EFGH`,
        expires_in: 20,
        interval: 1,
      })
    }
    if (request.url === '/api/cli/device_authorizations/token' && request.method === 'POST') {
      seen.polls += 1
      assert.equal(request.headers.authorization, undefined)
      assert.deepEqual(await jsonRequest(request), { device_code: 'device-secret' })
      return sendJson(response, 200, {
        access_token: 'trm_fresh',
        token_type: 'Bearer',
        account: { id: 7, name: 'Kieran', email: 'kieran@example.com' },
      })
    }
    if (request.url === '/api/cli/session' && request.method === 'GET') {
      assert.equal(request.headers.authorization, 'Bearer trm_fresh')
      return sendJson(response, 200, {
        account: { id: 7, name: 'Kieran', email: 'kieran@example.com' },
        token: { name: 'Thinkroom CLI' },
      })
    }
    if (request.url === '/api/docs' && request.method === 'POST') {
      assert.equal(request.headers.authorization, 'Bearer trm_fresh')
      assert.equal(request.headers['x-agent-name'], 'Codex')
      seen.created = await jsonRequest(request)
      return sendJson(response, 201, { slug: 'abc123', share_url: `${server.url}/d/abc123` })
    }
    return sendJson(response, 404, { error: `Unexpected ${request.method} ${request.url}` })
  })
  t.after(() => server.close())

  const loggedIn = await runCli(['login', '--url', server.url, '--no-open'], { cwd: root, configHome })
  assert.equal(loggedIn.code, 0, loggedIn.stderr)
  assert.match(loggedIn.stdout, /Connected as Kieran/)
  assert.equal(seen.polls, 1)

  const configFile = path.join(configHome, 'thinkroom', 'config.json')
  const stored = JSON.parse(await readFile(configFile, 'utf8'))
  assert.equal(stored.token, 'trm_fresh')
  assert.equal(stored.url, server.url)
  if (process.platform !== 'win32') assert.equal((await stat(configFile)).mode & 0o777, 0o600)

  const identity = await runCli(['whoami'], { cwd: root, configHome })
  assert.equal(identity.code, 0, identity.stderr)
  assert.match(identity.stdout, /Kieran <kieran@example\.com>/)

  const created = await runCli(
    ['new', '-', '--title', 'CLI draft', '--agent', 'Codex'],
    { cwd: root, configHome, input: '# Draft\n' },
  )
  assert.equal(created.code, 0, created.stderr)
  assert.equal(created.stdout.trim(), `${server.url}/d/abc123`)
  assert.deepEqual(seen.created, { title: 'CLI draft', content: '# Draft\n' })
})

test('document commands normalize share URLs and surface API failures', async (t) => {
  const root = await temporaryDirectory('documents')
  const configHome = path.join(root, 'config')
  const seen = []
  const server = await startServer(async (request, response) => {
    const body = ['POST', 'PATCH'].includes(request.method) ? await jsonRequest(request) : null
    seen.push({ method: request.method, url: request.url, body, agent: request.headers['x-agent-name'] })
    if (request.method === 'GET' && request.url === '/api/docs/slug123') {
      return sendJson(response, 200, { slug: 'slug123', content: '# Current' })
    }
    if (request.method === 'PATCH' && request.url === '/api/docs/slug123') {
      return sendJson(response, 409, { error: 'Live state is authoritative.', how_to_revise: 'Propose a suggestion.' })
    }
    if (request.method === 'PATCH' && request.url === '/api/docs/owned123') {
      return sendJson(response, 200, { share_url: `${server.url}/d/owned123` })
    }
    if (request.method === 'POST' && request.url === '/api/docs/slug123/suggestions') {
      return sendJson(response, 201, { suggestion: { id: 12 } })
    }
    if (request.method === 'POST' && request.url === '/api/docs/slug123/comments') {
      return sendJson(response, 201, { comment: { id: 13 } })
    }
    return sendJson(response, 404, { error: 'Unexpected request' })
  })
  t.after(() => server.close())
  const env = { THINKROOM_URL: server.url }

  const shown = await runCli(['show', `${server.url}/d/slug123`], { cwd: root, configHome, env })
  assert.equal(shown.code, 0, shown.stderr)
  assert.equal(shown.stdout.trim(), '# Current')
  assert.equal(shown.stderr, '', 'read-only show must not warn about agent identity')

  const updated = await runCli(['update', 'slug123', '-', '--agent', 'Codex'], {
    cwd: root, configHome, env, input: '# Revision',
  })
  assert.equal(updated.code, 1)
  assert.match(updated.stderr, /Propose a suggestion/)

  const ownerUpdated = await runCli(['update', 'owned123', '-', '--agent', 'Codex'], {
    cwd: root, configHome, env, input: '# Owner revision',
  })
  assert.equal(ownerUpdated.code, 0, ownerUpdated.stderr)
  assert.equal(ownerUpdated.stdout.trim(), `${server.url}/d/owned123`)

  const suggested = await runCli([
    'suggest', `${server.url}/d/slug123`, '--body', 'New', '--replaces', 'Old', '--intent', 'Tighten', '--agent', 'Codex',
  ], { cwd: root, configHome, env })
  assert.equal(suggested.code, 0, suggested.stderr)
  assert.match(suggested.stdout, /Suggestion 12/)

  const commented = await runCli(['comment', 'slug123', '--body', 'Check this', '--anchor', 'Current', '--agent', 'Scout'], {
    cwd: root, configHome, env,
  })
  assert.equal(commented.code, 0, commented.stderr)
  assert.match(commented.stdout, /Comment 13/)

  assert.deepEqual(seen[3].body, { body: 'New', intent: 'Tighten', replaces: 'Old' })
  assert.equal(seen[3].agent, 'Codex')
  assert.deepEqual(seen[4].body, { body: 'Check this', anchor_text: 'Current' })
  assert.equal(seen[4].agent, 'Scout')
})

test('writes warn on the generic identity fallback and honor THINKROOM_AGENT', async (t) => {
  const root = await temporaryDirectory('agent-fallback')
  const configHome = path.join(root, 'config')
  await mkdir(path.join(configHome, 'thinkroom'), { recursive: true })

  const seen = []
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/docs' && request.method === 'POST') {
      seen.push({ agent: request.headers['x-agent-name'], body: await jsonRequest(request) })
      return sendJson(response, 201, { slug: 'doc1', share_url: `${server.url}/d/doc1` })
    }
    return sendJson(response, 404, { error: `Unexpected ${request.method} ${request.url}` })
  })
  t.after(() => server.close())

  await writeFile(
    path.join(configHome, 'thinkroom', 'config.json'),
    JSON.stringify({ token: 'trm_test', url: server.url }),
  )

  // No --agent and no THINKROOM_AGENT: send the generic identity but warn loudly.
  const fallback = await runCli(['new', '-', '--title', 'Anon draft'], {
    cwd: root,
    configHome,
    input: '# Draft\n',
    env: { THINKROOM_URL: server.url, THINKROOM_AGENT: '' },
  })
  assert.equal(fallback.code, 0, fallback.stderr)
  assert.equal(fallback.stdout.trim(), `${server.url}/d/doc1`)
  assert.match(fallback.stderr, /No agent identity set/)
  assert.match(fallback.stderr, /--agent/)
  assert.equal(seen[0].agent, 'Thinkroom CLI')

  // THINKROOM_AGENT supplies identity: forward it and stay silent.
  const fromEnv = await runCli(['new', '-', '--title', 'Env draft'], {
    cwd: root,
    configHome,
    input: '# Draft\n',
    env: { THINKROOM_URL: server.url, THINKROOM_AGENT: 'Claude' },
  })
  assert.equal(fromEnv.code, 0, fromEnv.stderr)
  assert.equal(seen[1].agent, 'Claude')
  assert.equal(fromEnv.stderr, '', 'an explicit THINKROOM_AGENT must suppress the fallback warning')
})
