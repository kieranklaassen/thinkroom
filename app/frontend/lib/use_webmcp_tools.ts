import { useEffect, useRef } from 'react'
import {
  errorMessage,
  errorResult,
  getModelContext,
  isAbortError,
  toolNameValid,
  toSpecAnnotations,
  type WebmcpManifestTool,
  type WebmcpResult,
} from './webmcp'

/**
 * Page-supplied executor. Receives the run's abort signal so every fetch it
 * starts is cancelled together with the registration on cleanup.
 */
export type WebmcpExecutor = (
  tool: WebmcpManifestTool,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<WebmcpResult>

interface UseWebmcpToolsOptions {
  /** Page identity (`doc.slug` or `"index"`); the only effect dependency. */
  key: string
  tools: WebmcpManifestTool[]
  execute: WebmcpExecutor
}

/**
 * Registers the manifest's tools on `document.modelContext` once per page
 * identity and unregisters them on cleanup.
 *
 * `tools` and `execute` are read through refs so the effect depends on `key`
 * alone: a partial Inertia reload re-sends a fresh `tools` array and must not
 * re-register (duplicate names reject with `InvalidStateError`). Each run
 * owns one `AbortController`; its signal goes to every `registerTool` and to
 * every fetch, so aborting on cleanup is the single wrong-document guard.
 * StrictMode's mount→cleanup→mount aborts the first registration
 * synchronously, so the second never sees a duplicate name. A browser
 * without WebMCP returns early and logs nothing (R1).
 */
export function useWebmcpTools({ key, tools, execute }: UseWebmcpToolsOptions): void {
  const toolsRef = useRef(tools)
  toolsRef.current = tools
  const executeRef = useRef(execute)
  executeRef.current = execute

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    // Results are data, never exceptions (KTD4): a throw would reach the
    // agent as a bare UnknownError and `undefined` fails serialization.
    // The fetch aborts on either signal: the page-lifetime one (cleanup) or
    // the per-call one the agent passes when it cancels the execution, so a
    // cancelled write never reaches the server.
    const run = async (
      tool: WebmcpManifestTool,
      args: Record<string, unknown>,
      callSignal?: AbortSignal,
    ): Promise<WebmcpResult> => {
      try {
        const combined = callSignal ? AbortSignal.any([signal, callSignal]) : signal
        const result = await executeRef.current(tool, args ?? {}, combined)
        if (result === undefined || result === null) {
          return errorResult({ error: `${tool.name} returned no result` })
        }
        return result
      } catch (error) {
        return errorResult({ error: errorMessage(error) })
      }
    }

    // Development seam for the Playwright check: hand-built manifest entries
    // go through the real interpreter without a WebMCP-capable browser.
    // Installed before the feature gate so the interpreter can be exercised
    // from any dev browser; removed on cleanup so it never outlives its page.
    if (import.meta.env.DEV) {
      window.__thinkroomWebmcp = { execute: (tool, args) => run(tool, args) }
    }

    const teardown = () => {
      controller.abort()
      if (import.meta.env.DEV && window.__thinkroomWebmcp?.execute) {
        delete window.__thinkroomWebmcp
      }
    }

    const context = getModelContext()
    if (!context) return teardown

    for (const tool of toolsRef.current) {
      if (import.meta.env.DEV && !toolNameValid(tool.name)) {
        console.warn(`[webmcp] skipping tool with invalid name: ${JSON.stringify(tool.name)}`)
        continue
      }
      try {
        // `Promise.resolve` covers an implementation that returns void
        // synchronously; the spec's Promise rejects asynchronously.
        Promise.resolve(
          context.registerTool(
            {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.input_schema,
              annotations: toSpecAnnotations(tool.annotations),
              execute: (input, options) => run(tool, input, options?.signal),
            },
            { signal },
          ),
        ).catch((error: unknown) => reportRegistrationError(tool.name, error))
      } catch (error) {
        reportRegistrationError(tool.name, error)
      }
    }

    return teardown
  }, [key])
}

/**
 * AbortError is the expected outcome of StrictMode's synchronous cleanup and
 * of navigating away mid-registration, so it is silent. InvalidStateError
 * (duplicate name) and anything else are real and worth a line in dev tools.
 */
function reportRegistrationError(name: string, error: unknown): void {
  if (isAbortError(error)) return
  if (error instanceof Error && error.name === 'InvalidStateError') {
    console.warn(`[webmcp] ${name} is already registered; skipping`)
    return
  }
  console.warn(`[webmcp] failed to register ${name}: ${errorMessage(error)}`)
}
