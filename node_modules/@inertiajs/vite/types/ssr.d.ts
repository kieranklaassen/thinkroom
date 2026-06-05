/**
 * SSR Dev Server
 *
 * This module handles SSR rendering during development. Instead of running
 * a separate Node.js SSR server, the Vite dev server exposes an HTTP endpoint
 * that Laravel can call to render pages server-side.
 *
 * How it works:
 * 1. Laravel detects that the Vite dev server is running
 * 2. Laravel POSTs the page data to `/__inertia_ssr`
 * 3. This module loads the SSR entry file via Vite's SSR module loader
 * 4. The entry file's default export is called with the page data
 * 5. The rendered HTML is returned to Laravel
 *
 * This approach provides:
 * - Hot Module Replacement (HMR) for SSR code during development
 * - No need to restart a separate SSR server when code changes
 * - Automatic TypeScript/JSX transformation via Vite
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ResolvedConfig, ViteDevServer } from 'vite';
/** Options for the SSR dev server and production builds. */
export interface InertiaSSROptions {
    /**
     * Path to the SSR entry file. Auto-detected when not specified.
     */
    entry?: string;
    /**
     * Port number for the SSR server (used in production builds).
     */
    port?: number;
    /**
     * Host to bind the SSR server to (used in production builds).
     */
    host?: string;
    /**
     * Enable cluster mode for the SSR server (used in production builds).
     */
    cluster?: boolean;
    /**
     * When enabled, SSR errors are formatted with hints instead of thrown raw.
     * Defaults to true.
     */
    formatErrors?: boolean;
    /**
     * Enable sourcemaps for SSR builds so error stacks map to original files.
     * Defaults to true.
     */
    sourcemap?: boolean;
}
export declare const SSR_ENDPOINT = "/__inertia_ssr";
export declare const SSR_ENTRY_CANDIDATES: string[];
export declare function resolveSSREntry(options: InertiaSSROptions, config: ResolvedConfig): string | null;
export declare function handleSSRRequest(server: ViteDevServer, entry: string, req: IncomingMessage, res: ServerResponse, formatErrors?: boolean): Promise<void>;
