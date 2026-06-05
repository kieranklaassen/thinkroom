/**
 * Vue Framework Configuration
 *
 * This file defines how the Vite plugin handles Vue applications.
 * It serves as a reference for creating custom framework configurations.
 *
 * The SSR template shows what the plugin generates. For a user's SSR entry:
 *
 * ```js
 * import { createInertiaApp } from '@inertiajs/vue3'
 *
 * createInertiaApp({
 *   resolve: (name) => resolvePageComponent(name),
 * })
 * ```
 *
 * The plugin transforms it to:
 *
 * ```js
 * import { createInertiaApp } from '@inertiajs/vue3'
 * import createServer from '@inertiajs/vue3/server'
 * import { renderToString } from 'vue/server-renderer'
 *
 * const render = await createInertiaApp({
 *   resolve: (name) => resolvePageComponent(name),
 * })
 *
 * const renderPage = (page) => render(page, renderToString)
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
