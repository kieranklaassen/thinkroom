/**
 * Framework Registry
 *
 * This module exports the default framework configurations for Vue, React, and Svelte.
 * The plugin uses this registry to detect which framework is being used and apply
 * the appropriate transforms.
 *
 * Custom frameworks can be added via the `frameworks` plugin option, which will
 * be merged with these defaults (custom configs override defaults with the same package name).
 */
import type { FrameworkConfig } from '../types';
/**
 * Framework configs keyed by package name for efficient lookup.
 *
 * Example:
 * {
 *   '@inertiajs/vue3': { package: '@inertiajs/vue3', extensions: ['.vue'], ... },
 *   '@inertiajs/react': { package: '@inertiajs/react', extensions: ['.tsx', '.jsx'], ... },
 *   '@inertiajs/svelte': { package: '@inertiajs/svelte', extensions: ['.svelte'], ... }
 * }
 */
export declare const defaultFrameworks: Record<string, FrameworkConfig>;
