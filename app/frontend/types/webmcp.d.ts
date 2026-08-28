// Hand-written ambient types for WebMCP (W3C Web Machine Learning CG editor's
// draft, 2026-08-26): `document.modelContext.registerTool(tool, { signal })`.
// Only the current spec surface is declared — no `provideContext`,
// `unregisterTool`, or `navigator.modelContext`, which the draft removed.
// Typing this by hand avoids pulling an MCP server package into the bundle
// for a handful of interfaces while the spec is still moving.
// https://webmachinelearning.github.io/webmcp/

/**
 * The only two annotations the draft defines. `untrustedContentHint` marks
 * tools whose results can carry attacker-written text (document bodies,
 * comments, presence names) so the agent treats it as data.
 */
interface ToolAnnotations {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

/**
 * Executes a tool call. Results must be JSON-serializable; a rejection
 * surfaces to the agent as a bare `UnknownError`, so page code wraps every
 * failure into an MCP-style error result instead of throwing.
 */
type ToolExecuteCallback = (
  input: Record<string, unknown>,
  options: ToolExecuteCallbackOptions,
) => unknown | Promise<unknown>

/** Per-execution options; `signal` aborts when the agent cancels the call. */
interface ToolExecuteCallbackOptions {
  readonly signal: AbortSignal
}

interface ModelContextTool {
  name: string
  description: string
  /** JSON Schema for `input`; WebIDL `object`, not validated by the page. */
  inputSchema?: object
  annotations?: ToolAnnotations
  execute: ToolExecuteCallback
}

/** Unregistration is AbortSignal-only in the current draft. */
interface ModelContextRegisterToolOptions {
  signal?: AbortSignal
}

interface ModelContextGetToolOptions {
  signal?: AbortSignal
}

interface ModelContextExecuteToolOptions {
  signal?: AbortSignal
}

/** Read-only view of a registered tool as returned by `getTools()`. */
interface RegisteredTool {
  readonly name: string
  readonly description: string
  readonly inputSchema?: object
  readonly annotations?: ToolAnnotations
}

interface ModelContextEventMap {
  toolchange: Event
}

interface ModelContext extends EventTarget {
  /** Rejects with `InvalidStateError` when `tool.name` is already registered. */
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<void>
  getTools(options?: ModelContextGetToolOptions): RegisteredTool[]
  executeTool(
    name: string,
    input: Record<string, unknown>,
    options?: ModelContextExecuteToolOptions,
  ): Promise<unknown>
  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null
  addEventListener<K extends keyof ModelContextEventMap>(
    type: K,
    listener: (this: ModelContext, ev: ModelContextEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener<K extends keyof ModelContextEventMap>(
    type: K,
    listener: (this: ModelContext, ev: ModelContextEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void
}

/**
 * Present only in WebMCP-capable browsers (Chrome origin trial 149–156).
 * Always go through `getModelContext()` in `lib/webmcp.ts`, which also
 * checks that `registerTool` is callable.
 */
interface Document {
  readonly modelContext?: ModelContext
}

/**
 * Development-only seam installed by `useWebmcpTools` so the Playwright check
 * can push hand-built manifest entries through the real interpreter without
 * a WebMCP browser. Absent in production builds. Inline `import()` types keep
 * this file a global script while sharing the manifest types with the hook.
 */
interface Window {
  __thinkroomWebmcp?: {
    execute: (
      tool: import('../lib/webmcp').WebmcpManifestTool,
      args: Record<string, unknown>,
    ) => Promise<import('../lib/webmcp').WebmcpResult>
  }
}
