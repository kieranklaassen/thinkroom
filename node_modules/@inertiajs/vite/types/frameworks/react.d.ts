/**
 * React Framework Configuration
 *
 * This file defines how the Vite plugin handles React applications.
 * It serves as a reference for creating custom framework configurations.
 *
 * The SSR template shows what the plugin generates. For a user's SSR entry:
 *
 * ```js
 * import { createInertiaApp } from '@inertiajs/react'
 *
 * createInertiaApp({
 *   resolve: (name) => resolvePageComponent(name),
 * })
 * ```
 *
 * In production, the plugin transforms it to:
 *
 * ```js
 * import { createInertiaApp } from '@inertiajs/react'
 * import createServer from '@inertiajs/react/server'
 * import { renderToString } from 'react-dom/server'
 *
 * const render = await createInertiaApp({
 *   resolve: (name) => resolvePageComponent(name),
 * })
 *
 * createServer((page) => render(page, renderToString))
 * ```
 *
 * In development, it exports the render function directly for the Vite dev server.
 */
import type { FrameworkConfig } from '../types';
export declare const config: FrameworkConfig;
