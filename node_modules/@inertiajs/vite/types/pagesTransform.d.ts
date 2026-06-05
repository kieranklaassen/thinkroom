/**
 * Pages Transform
 *
 * This module transforms the `pages` shorthand into a full `resolve` function.
 * Instead of writing verbose glob code in every project, users can simply write:
 *
 * ```js
 * createInertiaApp({ pages: './Pages' })
 * ```
 *
 * Which gets transformed into:
 *
 * ```js
 * createInertiaApp({
 *   resolve: async (name, page) => {
 *     const pages = import.meta.glob('./Pages/*.vue')
 *     const module = await (pages[`./Pages/${name}.vue`])?.()
 *     if (!module) throw new Error(`Page not found: ${name}`)
 *     return module.default ?? module
 *   }
 * })
 * ```
 *
 * The transform also supports advanced configuration:
 *
 * ```js
 * createInertiaApp({
 *   pages: {
 *     path: './Pages',
 *     extension: '.tsx',
 *     lazy: true,
 *     transform: (name, page) => name.replace('/', '-')
 *   }
 * })
 * ```
 */
import type { FrameworkConfig } from './types';
export interface PageTransformResult {
    code: string;
    pageGlobs: string[];
}
/** Returns the transformed code with page globs, or null if no transformation was needed. */
export declare function transformPageResolution(code: string, frameworks: Record<string, FrameworkConfig>): PageTransformResult | null;
