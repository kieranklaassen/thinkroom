/**
 * Svelte Framework Configuration
 *
 * This file defines how the Vite plugin handles Svelte applications.
 * It serves as a reference for creating custom framework configurations.
 *
 * The SSR template shows what the plugin generates. For a user's SSR entry:
 *
 * ```js
 * import { createInertiaApp } from '@inertiajs/svelte'
 *
 * createInertiaApp({
 *   resolve: (name) => resolvePageComponent(name),
 * })
 * ```
 *
 * The plugin transforms it to:
 *
 * ```js
 * import { createInertiaApp } from '@inertiajs/svelte'
 * import createServer from '@inertiajs/svelte/server'
 * import { render } from 'svelte/server'
 *
 * const ssr = await createInertiaApp({
 *   resolve: (name) => resolvePageComponent(name),
 * })
 *
 * const renderPage = (page) => ssr(page, render)
 *
 * // Only start server in production
 * if (import.meta.env.PROD) {
 *   createServer(renderPage)
 * }
 *
 * export default renderPage
 * ```
 */
import type { FrameworkConfig } from '../types';
export declare const config: FrameworkConfig;
