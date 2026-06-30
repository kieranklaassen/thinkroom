#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  open as openFile,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const VERSION = '0.1.0'
const DEFAULT_URL = 'https://thinkroom.kieranklaassen.com'
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

class ApiError extends CliError {
  constructor(status, payload) {
    const detail = payload?.error_description || payload?.error || `Thinkroom returned HTTP ${status}.`
    const next = payload?.next_action || payload?.how_to_revise
    super(next ? `${detail}\n${next}` : detail)
    this.status = status
    this.payload = payload
  }
}

function parseArgs(argv) {
  const options = {}
  const positionals = []
  const booleans = new Set(['json', 'help', 'version', 'no-open'])

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }

    const [rawKey, inlineValue] = argument.slice(2).split(/=(.*)/s, 2)
    if (booleans.has(rawKey)) {
      options[rawKey] = true
      continue
    }

    const value = inlineValue ?? argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new CliError(`Missing value for --${rawKey}.`)
    options[rawKey] = value
    if (inlineValue === undefined) index += 1
  }

  return { command: positionals.shift(), positionals, options }
}

function configDirectory() {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'thinkroom')
    : path.join(homedir(), '.config', 'thinkroom')
}

function configPath() {
  return path.join(configDirectory(), 'config.json')
}

async function loadConfig() {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    if (error instanceof SyntaxError) throw new CliError(`Could not parse ${configPath()}.`)
    throw error
  }
}

async function saveConfig(config) {
  const directory = configDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const temporary = `${configPath()}.${process.pid}.tmp`
  const handle = await openFile(temporary, fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_TRUNC, 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`)
  } finally {
    await handle.close()
  }
  await rename(temporary, configPath())
  await chmod(configPath(), 0o600)
}

function normalizeBaseUrl(value) {
  const candidate = value || DEFAULT_URL
  let url
  try {
    url = new URL(candidate)
  } catch {
    throw new CliError(`Invalid Thinkroom URL: ${candidate}`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new CliError('Thinkroom URL must use http or https.')
  return url.toString().replace(/\/$/, '')
}

async function connection(options, { requireToken = false } = {}) {
  const config = await loadConfig()
  const baseUrl = normalizeBaseUrl(options.url || options.host || process.env.THINKROOM_URL || config.url)
  const token = process.env.THINKROOM_TOKEN || config.token
  if (requireToken && !token) throw new CliError('Not connected to a Thinkroom account. Run `thinkroom login` first.')
  return { config, baseUrl, token }
}

async function request(endpoint, options, requestOptions = {}) {
  const { requireToken = false, useToken = true, agent, method = 'GET', body } = requestOptions
  const { config, baseUrl, token } = await connection(options, { requireToken })
  const headers = { Accept: 'application/json' }
  if (useToken && token) headers.Authorization = `Bearer ${token}`
  if (agent) headers['X-Agent-Name'] = agent
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new CliError(`Could not reach ${baseUrl}: ${error.message}`)
  }

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { error: text }
    }
  }
  if (!response.ok) throw new ApiError(response.status, payload)
  return { payload, config, baseUrl, response }
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

// Identity is self-asserted via --agent or THINKROOM_AGENT. We never invent one:
// a fabricated default would attribute every forgotten write to a meaningless
// generic name, which is exactly the provenance pollution this avoids.
function agentIdentity(options) {
  return (options.agent || process.env.THINKROOM_AGENT || '').trim() || undefined
}

// Writes must be attributable, so refuse to send one without an identity rather
// than silently misattributing it (the raw API likewise requires X-Agent-Name).
function requireAgent(options) {
  const name = agentIdentity(options)
  if (!name) {
    throw new CliError(
      'Set your agent identity before writing so this edit is attributed to you.\n' +
        'Pass --agent NAME (for example --agent "Claude") or set THINKROOM_AGENT.',
    )
  }
  return name
}

function slugFrom(value) {
  if (!value) throw new CliError('A Thinkroom slug or share URL is required.')
  try {
    const url = new URL(value)
    const match = url.pathname.match(/\/(?:d|api\/docs)\/([^/]+)/)
    if (match) return decodeURIComponent(match[1])
  } catch {
    // A bare slug is expected to fail URL parsing.
  }
  const slug = value.trim()
  if (/^[A-Za-z0-9_-]+$/.test(slug)) return slug
  throw new CliError(`Could not find a Thinkroom document slug in: ${value}`)
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function readContent(file) {
  if (file && file !== '-') return readFile(path.resolve(file), 'utf8')
  if (file === '-' || !process.stdin.isTTY) return readStdin()
  return undefined
}

function openBrowser(url) {
  const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return true
  } catch {
    return false
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function login(options) {
  if (process.env.THINKROOM_TOKEN) {
    throw new CliError('THINKROOM_TOKEN is set. Unset it before connecting a different account with `thinkroom login`.')
  }
  const config = await loadConfig()
  const baseUrl = normalizeBaseUrl(options.url || options.host || process.env.THINKROOM_URL || config.url)
  const started = await request(
    '/api/cli/device_authorizations',
    { ...options, url: baseUrl },
    { method: 'POST', body: {}, useToken: false },
  )
  const grant = started.payload

  process.stderr.write(`Connection code: ${grant.user_code}\n`)
  process.stderr.write(`Approve in your browser: ${grant.verification_url}\n`)
  if (!options['no-open'] && openBrowser(grant.verification_url)) process.stderr.write('Opened your browser.\n')

  const deadline = Date.now() + grant.expires_in * 1000
  let interval = Math.max(Number(grant.interval) || 2, 1)
  while (Date.now() < deadline) {
    await delay(interval * 1000)
    try {
      const exchanged = await request(
        '/api/cli/device_authorizations/token',
        { ...options, url: baseUrl },
        { method: 'POST', body: { device_code: grant.device_code }, useToken: false },
      )
      const nextConfig = {
        ...config,
        url: baseUrl,
        token: exchanged.payload.access_token,
        account: exchanged.payload.account,
      }
      await saveConfig(nextConfig)
      if (options.json) printJson({ url: baseUrl, account: exchanged.payload.account })
      else process.stdout.write(`Connected as ${exchanged.payload.account.name} (${exchanged.payload.account.email}).\n`)
      return
    } catch (error) {
      if (error instanceof ApiError && error.payload?.error === 'authorization_pending') continue
      if (error instanceof ApiError && error.payload?.error === 'slow_down') {
        interval += 1
        continue
      }
      throw error
    }
  }
  throw new CliError('The browser approval expired. Run `thinkroom login` to try again.')
}

async function whoami(options) {
  const result = await request('/api/cli/session', options, { requireToken: true })
  if (options.json) printJson(result.payload)
  else process.stdout.write(`${result.payload.account.name} <${result.payload.account.email}>\n${result.baseUrl}\n`)
}

async function logout(options) {
  const { config, token } = await connection(options)
  if (token) {
    try {
      await request('/api/cli/session', options, { method: 'DELETE' })
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
    }
  }
  await saveConfig({ ...config, token: undefined, account: undefined })
  process.stdout.write(process.env.THINKROOM_TOKEN
    ? 'Revoked the token, but THINKROOM_TOKEN remains set in this environment. Unset it to disconnect fully.\n'
    : 'Disconnected from Thinkroom.\n')
}

async function createDocument(positionals, options) {
  const agent = requireAgent(options)
  const content = await readContent(positionals[0])
  const body = {}
  if (options.title) body.title = options.title
  if (content !== undefined) body.content = content
  if (options.format) body.format = options.format
  const result = await request('/api/docs', options, {
    method: 'POST',
    body,
    requireToken: true,
    agent,
  })
  if (options.json) printJson(result.payload)
  else process.stdout.write(`${result.payload.share_url}\n`)
}

async function showDocument(positionals, options) {
  const slug = slugFrom(positionals[0])
  // Read-only: forward an identity if one was given (presence), but never
  // fabricate one — an unidentified read must not create a presence chip.
  const result = await request(`/api/docs/${encodeURIComponent(slug)}`, options, { agent: agentIdentity(options) })
  if (options.json) printJson(result.payload)
  else process.stdout.write(`${result.payload.content ?? result.payload.markdown ?? ''}\n`)
}

async function updateDocument(positionals, options) {
  const agent = requireAgent(options)
  const slug = slugFrom(positionals[0])
  const content = await readContent(positionals[1])
  const body = {}
  if (options.title) body.title = options.title
  if (content !== undefined) body.content = content
  if (options.format) body.format = options.format
  if (Object.keys(body).length === 0) throw new CliError('Provide a file/stdin and/or --title to update the document.')
  const result = await request(`/api/docs/${encodeURIComponent(slug)}`, options, {
    method: 'PATCH',
    body,
    agent,
  })
  if (options.json) {
    printJson(result.payload)
  } else {
    process.stdout.write(`${result.payload.share_url}\n`)
    // auto_rejected_suggestions is only present on a live-document
    // replacement (see Api::DocsController#update). Surfacing it here too
    // -- not just in --json mode -- is the point of this field: a CLI
    // caller in default mode must not learn about cleared suggestions only
    // by later hitting a confusing "target missing" error from `suggest`.
    if (result.payload.auto_rejected_suggestions > 0) {
      const n = result.payload.auto_rejected_suggestions
      process.stderr.write(
        `Note: this replaced a live document and auto-rejected ${n} pending ` +
          `suggestion${n === 1 ? '' : 's'} that targeted removed text. Run ` +
          '`thinkroom show --json` to review the current suggestion queue.\n',
      )
    }
  }
}

async function suggest(positionals, options) {
  const agent = requireAgent(options)
  const slug = slugFrom(positionals[0])
  const bodyText = options.body ?? (await readContent(positionals[1]))
  if (!bodyText) throw new CliError('Suggestion body is required via --body, a file, or stdin.')
  const result = await request(`/api/docs/${encodeURIComponent(slug)}/suggestions`, options, {
    method: 'POST',
    agent,
    body: {
      body: bodyText,
      intent: options.intent,
      replaces: options.replaces,
      anchor_text: options.anchor,
    },
  })
  if (options.json) printJson(result.payload)
  else process.stdout.write(`Suggestion ${result.payload.suggestion.id} is pending human review.\n`)
}

async function comment(positionals, options) {
  const agent = requireAgent(options)
  const slug = slugFrom(positionals[0])
  const bodyText = options.body ?? (await readContent(positionals[1]))
  if (!bodyText) throw new CliError('Comment body is required via --body, a file, or stdin.')
  const result = await request(`/api/docs/${encodeURIComponent(slug)}/comments`, options, {
    method: 'POST',
    agent,
    body: { body: bodyText, anchor_text: options.anchor },
  })
  if (options.json) printJson(result.payload)
  else process.stdout.write(`Comment ${result.payload.comment.id} posted.\n`)
}

async function openDocument(positionals, options) {
  const slug = slugFrom(positionals[0])
  const { baseUrl } = await connection(options)
  const url = `${baseUrl}/d/${encodeURIComponent(slug)}`
  if (!openBrowser(url)) throw new CliError(`Could not open a browser. Visit ${url}`)
  process.stdout.write(`${url}\n`)
}

async function exists(candidate) {
  try {
    await access(candidate)
    return true
  } catch {
    return false
  }
}

async function projectRoot(start = process.cwd()) {
  let current = path.resolve(start)
  while (true) {
    if (await exists(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(start)
    current = parent
  }
}

async function markdownFiles(directory) {
  if (!(await exists(directory))) return []
  const results = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) results.push(...(await markdownFiles(candidate)))
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(candidate)
  }
  return results.sort()
}

async function prime(options) {
  const root = await projectRoot()
  const config = await loadConfig()
  const durable = []
  for (const filename of ['AGENTS.md', 'CLAUDE.md', 'CONCEPTS.md']) {
    const candidate = path.join(root, filename)
    if (await exists(candidate)) durable.push(candidate)
  }
  durable.push(...(await markdownFiles(path.join(root, 'docs', 'solutions'))))

  const activePlans = []
  for (const candidate of await markdownFiles(path.join(root, 'docs', 'plans'))) {
    const source = await readFile(candidate, 'utf8')
    if (/^status:\s*active\s*$/m.test(source.slice(0, 1000))) activePlans.push(candidate)
  }

  const relative = (candidate) => path.relative(root, candidate) || '.'
  const payload = {
    project_root: root,
    thinkroom_url: normalizeBaseUrl(options.url || options.host || process.env.THINKROOM_URL || config.url),
    account: config.account || null,
    durable_context: durable.map(relative),
    active_plans: activePlans.map(relative),
  }
  if (options.json) return printJson(payload)

  process.stdout.write(`# Thinkroom prime\n\nProject: ${root}\n`)
  process.stdout.write(`Account: ${payload.account ? `${payload.account.name} <${payload.account.email}>` : 'not connected (run thinkroom login when publishing)'}\n`)
  process.stdout.write(`Host: ${payload.thinkroom_url}\n\n`)
  process.stdout.write('Read the relevant durable context before substantial work:\n')
  if (payload.durable_context.length === 0) process.stdout.write('- No AGENTS/CLAUDE/CONCEPTS or docs/solutions files found.\n')
  else payload.durable_context.forEach((candidate) => process.stdout.write(`- ${candidate}\n`))
  if (payload.active_plans.length > 0) {
    process.stdout.write('\nActive plans:\n')
    payload.active_plans.forEach((candidate) => process.stdout.write(`- ${candidate}\n`))
  }
  process.stdout.write('\nUse Thinkroom for human judgment handoffs: new → share URL; show before update; suggest after human editing.\n')
}

async function skillSource() {
  const candidates = [
    process.env.THINKROOM_SKILL_SOURCE,
    path.resolve(scriptDirectory, '..', 'skill', 'thinkroom'),
    path.resolve(scriptDirectory, '..', 'share', 'thinkroom', 'skill', 'thinkroom'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, 'SKILL.md'))) return candidate
  }
  throw new CliError('The bundled Thinkroom skill is missing. Reinstall the CLI.')
}

async function skillTargets(root, requested) {
  const mapping = {
    agents: path.join(root, '.agents', 'skills', 'thinkroom'),
    claude: path.join(root, '.claude', 'skills', 'thinkroom'),
    codex: path.join(root, '.codex', 'skills', 'thinkroom'),
  }
  if (requested && requested !== 'all') {
    if (!mapping[requested]) throw new CliError('--agent must be agents, claude, codex, or all.')
    return [mapping[requested]]
  }
  if (requested === 'all') return Object.values(mapping)

  const detected = []
  for (const [agent, target] of Object.entries(mapping)) {
    if (await exists(path.join(root, `.${agent}`))) detected.push(target)
  }
  return detected.length > 0 ? detected : [mapping.agents]
}

async function installSkill(options) {
  const root = await projectRoot()
  const source = await skillSource()
  const targets = await skillTargets(root, options.agent)
  for (const target of targets) {
    await mkdir(path.join(target, 'agents'), { recursive: true })
    await copyFile(path.join(source, 'SKILL.md'), path.join(target, 'SKILL.md'))
    await copyFile(path.join(source, 'agents', 'openai.yaml'), path.join(target, 'agents', 'openai.yaml'))
    process.stdout.write(`Installed Thinkroom skill: ${path.relative(root, target)}\n`)
  }
}

async function init(options) {
  await installSkill(options)
  process.stdout.write('\n')
  await prime(options)
}

function help() {
  process.stdout.write(`Thinkroom CLI ${VERSION}\n\n`)
  process.stdout.write('Usage: thinkroom <command> [arguments] [options]\n\n')
  process.stdout.write('Account\n  login [--url URL] [--no-open]\n  whoami [--json]\n  logout\n\n')
  process.stdout.write('Documents\n  new [FILE|-] [--title TITLE] [--format markdown|html] --agent NAME [--json]\n  show SLUG|URL [--json]\n  update SLUG|URL [FILE|-] [--title TITLE] --agent NAME [--json]\n  suggest SLUG|URL [FILE|-] --body TEXT --replaces TEXT --intent TEXT --agent NAME\n  comment SLUG|URL [FILE|-] --body TEXT [--anchor TEXT] --agent NAME\n  open SLUG|URL\n\n')
  process.stdout.write('Writes require an agent identity: pass --agent NAME or set THINKROOM_AGENT.\n\n')
  process.stdout.write('Agent setup\n  init [--agent agents|claude|codex|all]\n  skill install [--agent agents|claude|codex|all]\n  prime [--json]\n\n')
  process.stdout.write('Environment: THINKROOM_URL, THINKROOM_TOKEN, THINKROOM_AGENT, XDG_CONFIG_HOME\n')
}

async function main(argv) {
  const { command, positionals, options } = parseArgs(argv)
  if (options.version || command === 'version') return process.stdout.write(`${VERSION}\n`)
  if (options.help || !command || command === 'help') return help()

  switch (command) {
    case 'login': return login(options)
    case 'logout': return logout(options)
    case 'whoami': return whoami(options)
    case 'new': return createDocument(positionals, options)
    case 'show': return showDocument(positionals, options)
    case 'update': return updateDocument(positionals, options)
    case 'suggest': return suggest(positionals, options)
    case 'comment': return comment(positionals, options)
    case 'open': return openDocument(positionals, options)
    case 'prime': return prime(options)
    case 'init': return init(options)
    case 'skill':
      if (positionals[0] !== 'install') throw new CliError('Usage: thinkroom skill install [--agent agents|claude|codex|all]')
      return installSkill(options)
    default: throw new CliError(`Unknown command: ${command}\nRun \`thinkroom help\` for usage.`)
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`)
  process.exitCode = error.exitCode || 1
})
