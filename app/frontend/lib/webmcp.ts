// Shared WebMCP contract for the page side: feature detection, the manifest
// shape `AgentGuide.webmcp_tools` ships as an Inertia prop, and the MCP-style
// result envelope every tool returns. Consumed by `use_webmcp_tools.ts`
// (registration) and `webmcp_execute.ts` (the request interpreter).

/**
 * Returns `document.modelContext` only when it is usable. `typeof document`
 * keeps SSR safe; the `registerTool` check guards against a partial or
 * foreign object occupying the property. No polyfill is ever loaded — in
 * every other browser the page behaves exactly as before.
 */
export function getModelContext(): ModelContext | null {
  if (typeof document === 'undefined') return null
  const context = document.modelContext
  if (!context || typeof context.registerTool !== 'function') return null
  return context
}

/**
 * Chrome refuses tool names outside this set, and a rejected registration
 * would otherwise surface only as a swallowed promise in production.
 */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/

export function toolNameValid(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name)
}

/** Manifest annotations arrive snake_case from Ruby; the spec wants camelCase. */
export interface WebmcpAnnotations {
  read_only_hint: boolean
  untrusted_content_hint: boolean
}

export function toSpecAnnotations(annotations: WebmcpAnnotations): ToolAnnotations {
  return {
    readOnlyHint: annotations.read_only_hint,
    untrustedContentHint: annotations.untrusted_content_hint,
  }
}

/**
 * One JSON Schema property. Only `maxLength` is read by the page (UTF-8 byte
 * cap enforced before a request is sent); everything else passes through to
 * the browser untouched.
 */
export interface WebmcpSchemaProperty {
  type?: string
  description?: string
  maxLength?: number
  minLength?: number
  enum?: string[]
  [key: string]: unknown
}

export interface WebmcpInputSchema {
  type: 'object'
  properties: Record<string, WebmcpSchemaProperty>
  required: string[]
  additionalProperties: false
}

/**
 * Everything the interpreter needs to turn a tool call into a fetch. `url`
 * is absolute, same-origin, under `/api/`, and may carry `:id` placeholders
 * named by `path_params`. `agent_name` is never a body param: the interpreter
 * lifts it into `X-Agent-Name` when `agent_identity` is `"required"`.
 */
export interface WebmcpRequest {
  method: 'GET' | 'POST'
  url: string
  path_params: string[]
  body_params: string[]
  agent_identity: 'required' | 'omit'
  /** Endpoint's `rate_limits.burst.within_seconds`; reported on 429 as an upper bound. */
  rate_limit_window_seconds?: number
}

interface WebmcpToolBase {
  name: string
  description: string
  input_schema: WebmcpInputSchema
  annotations: WebmcpAnnotations
  /** Merge the viewer's own capabilities into the result (R14). */
  include_viewer_context: boolean
}

export interface WebmcpRequestTool extends WebmcpToolBase {
  kind: 'request'
  request: WebmcpRequest
  static_text?: undefined
}

export interface WebmcpStaticTool extends WebmcpToolBase {
  kind: 'static'
  static_text: string
  request?: undefined
}

/** Discriminated on `kind` so the interpreter never reads a missing branch. */
export type WebmcpManifestTool = WebmcpRequestTool | WebmcpStaticTool

export interface WebmcpManifest {
  /** Document manifests only. */
  share_url?: string
  tools: WebmcpManifestTool[]
}

/**
 * MCP-style result. Always JSON-serializable and never `undefined`: the
 * spec turns a thrown execute into an opaque `UnknownError` and fails
 * serialization on `undefined`, so failures travel as data (KTD4).
 */
export interface WebmcpResult {
  content: [{ type: 'text'; text: string }]
  isError?: true
}

export function textResult(value: unknown): WebmcpResult {
  return { content: [{ type: 'text', text: asText(value) }] }
}

export function errorResult(value: unknown): WebmcpResult {
  return { content: [{ type: 'text', text: asText(value) }], isError: true }
}

/** Strings pass through verbatim; anything else is serialized as JSON. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}

/** Human-readable message from any thrown value, for error envelopes. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : String(error)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
