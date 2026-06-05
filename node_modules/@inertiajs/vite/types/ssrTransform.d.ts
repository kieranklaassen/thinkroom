/**
 * SSR Transform
 *
 * Transforms the SSR entry file by wrapping `createInertiaApp()` with
 * framework-specific server bootstrap code, so users don't need to
 * write the boilerplate manually.
 */
import type { FrameworkConfig, SSROptions } from './types';
/**
 * Quick check for a top-level call that needs SSR wrapping.
 */
export declare function findInertiaAppExport(code: string): boolean;
/**
 * Wrap `createInertiaApp()` or `createServer()` with the framework's SSR bootstrap.
 */
export declare function wrapWithServerBootstrap(code: string, options: SSROptions, frameworks: Record<string, FrameworkConfig>): string | null;
