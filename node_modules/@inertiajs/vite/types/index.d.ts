/**
 * Inertia.js Vite Plugin
 *
 * This plugin provides two main features:
 *
 * 1. **Pages shorthand** - Transforms `pages: './Pages'` into a full `resolve` function
 *    that uses `import.meta.glob` to load page components. This saves users from writing
 *    boilerplate glob code in every project.
 *
 * 2. **SSR dev server** - During development, wraps the SSR entry file with server bootstrap
 *    code and exposes an HTTP endpoint that Laravel can call to render pages server-side.
 *    This eliminates the need to run a separate Node.js SSR server during development.
 *
 * The plugin is framework-agnostic - it detects which Inertia adapter (Vue, React, Svelte)
 * is being used by looking at import statements, then applies the appropriate transforms.
 * Custom frameworks can be added via the `frameworks` option.
 */
import type { Plugin } from 'vite';
import { InertiaSSROptions } from './ssr';
import type { FrameworkConfig } from './types';
export type { FrameworkConfig, SSRTemplate } from './types';
export { InertiaSSROptions };
export interface InertiaPluginOptions {
    /**
     * SSR configuration. Pass a string for the entry path, an object for
     * additional options, or `false` to disable SSR entirely. Auto-detected
     * when not specified from:
     * - resources/js/ssr.{ts,tsx,js,jsx}
     * - src/ssr.{ts,tsx,js,jsx}
     * - resources/js/app.{ts,tsx,js,jsx}
     * - src/app.{ts,tsx,js,jsx}
     */
    ssr?: string | false | InertiaSSROptions;
    /**
     * Custom framework configurations. Use this to add support for frameworks
     * beyond the built-in Vue, React, and Svelte adapters.
     *
     * @example
     * ```ts
     * inertia({
     *   frameworks: {
     *     package: '@inertiajs/solid',
     *     extensions: ['.tsx', '.jsx'],
     *     extractDefault: true,
     *     ssr: (configureCall, options) => `
     *       import createServer from '@inertiajs/solid/server'
     *       const render = await ${configureCall}
     *       createServer((page) => render(page)${options})
     *     `,
     *   }
     * })
     * ```
     */
    frameworks?: FrameworkConfig | FrameworkConfig[];
}
export default function inertia(options?: InertiaPluginOptions): Plugin;
