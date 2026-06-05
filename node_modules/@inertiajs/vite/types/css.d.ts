/**
 * SSR CSS Collection
 *
 * Collects CSS dependencies from Vite's module graph to prevent FOUC
 * (Flash of Unstyled Content) during SSR development.
 *
 * In dev mode, Vite normally injects CSS via JavaScript on the client side.
 * When SSR is enabled, the server-rendered HTML arrives before any JS executes,
 * causing unstyled content to flash briefly. This module traverses the SSR
 * environment's module graph starting from the entry to find all CSS
 * dependencies, then generates <link> tags so the browser fetches styles
 * immediately with the initial HTML.
 *
 * The generated <link> tags include `data-vite-dev-id` attributes so Vite's
 * client JS can deduplicate them and avoid injecting duplicate <style> tags.
 */
import type { ViteDevServer } from 'vite';
export declare function collectCSSFromModuleGraph(server: ViteDevServer, entry: string): string[];
