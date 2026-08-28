import {
  errorMessage,
  errorResult,
  isAbortError,
  textResult,
  type WebmcpManifestTool,
  type WebmcpRequestTool,
  type WebmcpResult,
} from './webmcp'

interface ExecuteOptions {
  /** The registration run's signal; cancels the fetch when the page goes away. */
  signal?: AbortSignal
  /** Merged into results of tools flagged `include_viewer_context` (R14). */
  viewerContext?: Record<string, unknown>
}

// Adapted from `requireAgent` in cli/bin/thinkroom.js: same teaching, with
// the tool argument in place of the CLI flag.
const IDENTITY_ERROR =
  'Set your agent identity before writing so this edit is attributed to you. ' +
  'Pass agent_name (for example agent_name: "Claude") on every write tool call.'

const PATH_PARAM_PATTERN = /^\d+$/
const encoder = new TextEncoder()

/**
 * Turns a manifest tool plus arguments into a same-origin, cookie-less fetch
 * and an MCP-style result. Never throws and never returns `undefined`: one
 * outer boundary converts every failure — identity, allowlist, params,
 * headers, abort, network, parse — into an `isError` envelope (KTD4).
 */
export async function executeManifestTool(
  tool: WebmcpManifestTool,
  args: Record<string, unknown>,
  options: ExecuteOptions = {},
): Promise<WebmcpResult> {
  try {
    const input = args && typeof args === 'object' ? args : {}
    if (tool.kind === 'static') return staticResult(tool.static_text, tool, options)
    return await requestResult(tool, input, options)
  } catch (error) {
    if (isAbortError(error)) return errorResult({ error: 'cancelled' })
    return errorResult({ error: errorMessage(error) })
  }
}

function staticResult(
  text: string,
  tool: WebmcpManifestTool,
  options: ExecuteOptions,
): WebmcpResult {
  if (!tool.include_viewer_context) return textResult(text)
  return textResult({ text, viewer_context: options.viewerContext ?? null })
}

async function requestResult(
  tool: WebmcpRequestTool,
  args: Record<string, unknown>,
  options: ExecuteOptions,
): Promise<WebmcpResult> {
  const { request } = tool

  // Identity gate first: no network request is made without a name (R9).
  let agentName: string | null = null
  if (request.agent_identity === 'required') {
    agentName = typeof args.agent_name === 'string' ? args.agent_name.trim() : ''
    if (!agentName) return errorResult({ error: IDENTITY_ERROR })
  }

  const url = resolveUrl(request.url, request.path_params, args)
  if ('error' in url) return errorResult(url)

  const headers = new Headers({ Accept: 'application/json' })
  if (agentName !== null) {
    try {
      headers.set('X-Agent-Name', agentName)
    } catch {
      // Header values are ByteStrings; a name outside Latin-1 (an emoji, say)
      // throws here rather than on the wire.
      return errorResult({
        error: 'agent_name must use ASCII characters so it can travel in the X-Agent-Name header.',
      })
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    // The browser session grants no authorship: every write is attributed to
    // the named agent, never to the viewer, and the API stays Bearer-only.
    credentials: 'omit',
    signal: options.signal,
  }

  if (request.method === 'POST') {
    const body = buildBody(tool, args)
    if ('error' in body) return errorResult(body)
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(body.value)
  }

  let response: Response
  try {
    response = await fetch(url.value, init)
  } catch (error) {
    if (isAbortError(error)) return errorResult({ error: 'cancelled' })
    return errorResult({ error: 'unreachable', detail: errorMessage(error) })
  }

  const text = await response.text()
  const parsed = parseJson(text)
  const body = parsed.ok ? parsed.value : undefined

  if (response.ok) {
    // JSON.stringify explicitly: a bare JSON string body must stay quoted
    // rather than pass through verbatim like static text does.
    const success: unknown = parsed.ok ? body : { body: text }
    if (!tool.include_viewer_context) return textResult(JSON.stringify(success))
    const viewer_context = options.viewerContext ?? null
    return textResult(
      JSON.stringify(
        isPlainObject(success) ? { ...success, viewer_context } : { body: success, viewer_context },
      ),
    )
  }

  // A non-JSON body (proxy HTML, empty 502) is wrapped as a string so it is
  // never spread into character-indexed keys.
  const failure: Record<string, unknown> = isPlainObject(body)
    ? { status: response.status, ...body }
    : { status: response.status, body: parsed.ok ? body : text }
  if (response.status === 429 && typeof request.rate_limit_window_seconds === 'number') {
    // Upper bound only: the server uses fixed windows per IP, and a client
    // lockout would over-block for the whole window after one 429 (R15).
    failure.retry_after_seconds = request.rate_limit_window_seconds
  }
  return errorResult(failure)
}

type Outcome<T> = { value: T } | { error: string; [key: string]: unknown }

/**
 * Enforces R11 before any path substitution, then fills `:name` placeholders
 * with digit-only, URL-encoded values so an agent-supplied `id` can never
 * retarget the request to another same-origin route.
 */
function resolveUrl(
  template: string,
  pathParams: string[],
  args: Record<string, unknown>,
): Outcome<string> {
  let url: URL
  try {
    url = new URL(template, location.origin)
  } catch {
    return { error: `refused: malformed tool URL ${JSON.stringify(template)}` }
  }
  if (url.origin !== location.origin) {
    return { error: `refused: ${url.origin} is not the page origin` }
  }
  const path = url.pathname
  if (!path.startsWith('/api/')) {
    return { error: `refused: ${path} is outside /api/` }
  }
  if (path.startsWith('/api/cli/') || path === '/api/uploads' || path.startsWith('/api/uploads/')) {
    return { error: `refused: ${path} is not available to browser tools` }
  }

  let resolved = path
  for (const name of pathParams) {
    const raw = args[name]
    const value = typeof raw === 'number' ? String(raw) : raw
    if (typeof value !== 'string' || !PATH_PARAM_PATTERN.test(value)) {
      return { error: `${name} must be a numeric id`, field: name }
    }
    resolved = resolved.split(`:${name}`).join(encodeURIComponent(value))
  }
  if (/:[A-Za-z_]/.test(resolved)) {
    return { error: `refused: unresolved path parameter in ${resolved}` }
  }
  url.pathname = resolved
  return { value: url.toString() }
}

/**
 * Picks the declared `body_params` out of `args` and enforces each property's
 * `maxLength` as a UTF-8 byte cap — the server measures `bytesize`, so a
 * multibyte body can be under the character count yet over the limit.
 */
function buildBody(
  tool: WebmcpRequestTool,
  args: Record<string, unknown>,
): Outcome<Record<string, unknown>> {
  const body: Record<string, unknown> = {}
  for (const name of tool.request.body_params) {
    if (!(name in args) || args[name] === undefined) continue
    const value = args[name]
    const cap = tool.input_schema.properties[name]?.maxLength
    if (typeof cap === 'number' && typeof value === 'string') {
      const bytes = encoder.encode(value).length
      if (bytes > cap) {
        return {
          error: `${name} is ${bytes} bytes; the cap is ${cap} bytes of UTF-8.`,
          field: name,
          max_bytes: cap,
        }
      }
    }
    body[name] = value
  }
  return { value: body }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === '') return { ok: false }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
